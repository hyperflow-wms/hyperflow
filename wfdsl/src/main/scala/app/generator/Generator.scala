package app.generator

import app.grammar.Workflow
import scala.collection.mutable.LinkedHashMap
import app.grammar.Sequence
import scala.collection.mutable.HashSet
import scala.collection.mutable.MutableList
import app.Config.FunctionGenerationStrategy._
import app.Config

/*
 * A class that does all the hard work by interpreting the parsed
 * workflow specifications and generating JSON code.
 */
class Generator(val wf: Workflow) {
  private val out = new StringBuilder()
  private var indent = 0
  private var totalSignalsNum = 0
  private var totalFunctionsNum = 0
  private var totalTasksNum = 0
  
  val vars = scala.collection.mutable.Map[String, Any]()
  val signals = LinkedHashMap[String, Signal]()
  val functions = LinkedHashMap[String, Fun]()
  val tasks = LinkedHashMap[String, Task]() 
  val ins = scala.collection.mutable.MutableList[SimpleSignal]()
  val outs = scala.collection.mutable.MutableList[SimpleSignal]()

  def generate(args: List[String]): String = {
    prepareDataStructures(args)
    generateCode()
  }
  
  /*
   * Prepares data structures representing the workflow in order to
   * facilitate the code generation and check for errors
   */
  private def prepareDataStructures(args: List[String]) = {    
    addArgs(args)
    addVars()
    addSignals()
    addFunctions()
    addTasks()
    ins ++= resolveInsOuts(wf.ins)
    outs ++= resolveInsOuts(wf.outs)
    ""
  }
  
  /*
   * Generates code from the previously prepared data structures.
   * As they were previously prepared in whole, it's possible to change
   * the order of generation by moving the appropriate methods up and down,
   * as they don't have any dependencies on one another
   */
  private def generateCode() = {
    append("{")
    indent += 1
    printName()
    printConfig()
    printFunctions()
    printTasks()
    printSignals()
    printInsOuts("ins")
    printInsOuts("outs")
    removeLastComma()
    indent -= 1
    append("}")
    out.toString()
  }

  private def printName() = {
    append("\"name\": \"" + wf.name + "\",")
  }
  
  /*
   * Evaluates workflow args, i.e. the parameters passed in brackets here:
   * "workflow grepFiles(arg1, arg2)"
   * and adds them to vars, so they may be reference later from other
   * sections of the workflow
   */
  private def addArgs(args: List[String]) = {
    if (args.size != wf.args.size) {
      throw new Exception("Incorrect number of workflow arguments, expected " + wf.args.size + ", received " + args.size)
    }
    if (wf.args.distinct.size != wf.args.size) {
      throw new Exception("Workflow arguments have to be uniquely named")
    }
    val parsedArgs = args map (arg => evalArg(arg))
    vars ++= (wf.args zip parsedArgs).toMap[String, Any]
  }
  
  /*
   * As workflow args cannot reference any other variable, they may only
   * be primitives and are evaluated the following way:
   * "1" -> Int
   * "1.0" -> Double
   * "'a'" -> Char
   * ""str"" -> String
   */
  private def evalArg(arg: String): Any = {
    parse[Int](arg) match {
      case Some(i) => i
      case None => parse[Double](arg) match {
        case Some(d) => d
        case None => 
          if (arg.size == 3 && arg.charAt(0) == '\'' && arg.charAt(2) == '\'')
            arg.charAt(1)
          else if (arg.size >= 2 && arg.charAt(0) == '"' && arg.charAt(arg.size-1) == '"')
            arg.substring(1, arg.size - 1)
          else
            throw new Exception("Invalid argument format " + arg)
      }
    }
  }

  /*
   * Evaluates variables declared in vars section. Variables can only
   * reference other variables that were evaluated earlier.
   * There's no forward declaration or anything similar
   */
  private def addVars() = {
    for ((name, value) <- wf.vars) {      
      try {
	      if (vars.contains(name)) {
	        throw new Exception("Specified twice")
	      }
	      if (Config.reservedVarsNames contains name) {
	        throw new Exception("Is a reserved variable name and cannot be declared")
	      }
        vars += name -> evalVar(value)
      } catch {
        case e: Throwable => throw new Exception("[var " + name + "]" +e.getMessage())
      }
    }
  }
  
  /*
   * Takes a variable value as an argument and returns its primitive
   * value, i.e. evaluates all the referenced variables and indexes
   * The arguments may have the following format:
   * Sequence(from, to, step) - implicitly defined sequence, will be unfolded to List
   * (a) - variable named a
   * (a, b) - a[b]
   * const - primitive or explicit sequence e.g. {"a", "c", "f"}
   */
  def evalVar(value: Any): Any = {
    value match {
      case Sequence(from, to, step) => evalSeq(evalVar(from), evalVar(to), evalVar(step))
      case Tuple1(a: String) => vars.get(a) match {
        case Some(res) => res
        case _ => throw new Exception("Variable " + a + " undefined")
      }
      case Tuple1(a) => evalVar(a)
      case (a, b) => (evalVar(a), evalVar(b)) match {
        case (seq: List[Any], index: Int) => 
          if (seq.size > index && index >= 0) seq(index) 
          else throw new Exception("Index " + index + " is out of bounds of sequence " + a + " of size " + seq.size)
        case (seq: List[Any], _) => throw new Exception(a + " cannot take " + b + " as an index")
        case _ => throw new Exception(a + " is not a sequence and cannot be accessed with [] operator")
      }
      case None => throw new Exception("Could not evaluate variable " + value)
      case const => const
    }
  }
  
  /*
   * Evaluate a variable that needs additional variables for its evaluation.
   * For instance, when a sequence-based task uses var1[i] it should invoke
   * this method to evaluate it, as "i" is not a normally defined variable.
   * The additional variables and their values are passed in the second argument,
   * temporarily added to vars and then removed.
   */
  def evalVar(value: Any, extra: Map[String, Any]): Any = {
    vars ++= extra
    val res = evalVar(value)
    vars --= extra.keys
    res
  }
  
  /*
   * Unfolds Sequence(from, to, step) expressions to appropriate Lists
   */
  private def evalSeq(seq: Any): List[Any] = {
    seq match {
      case (from: Int, to: Int, step: Int) => (from.to(to).by(step)).toList
      case (from: Char, to: Char, step: Int) => (from.to(to).by(step.toChar)).toList
      case other => throw new Exception("Badly defined sequence " + other)
    }
  }
  
  /*
   * Adds Signals defined in "signals" section to variable signals
   */
  private def addSignals() = {
    var index = 0
    val signalNames: List[String] = wf.signals map Function.tupled((name, _, _) => name)
    if (signalNames.distinct.size != signalNames.size) {
      throw new Exception("Signal names have to be unique")
    }
    for(signal <- wf.signals) {
      try {
	      signal match {
	        case (name, null, args) => {
	          signals += name -> new Signal(name, null, args, index, this)
	          index += 1
	        }
	        case (name, seq, args) => vars.get(seq) match {
	          case Some(l: List[Any]) => {
	            signals += name -> new Signal(name, l, args, index, this)
	            index += l.size
	          }
	          case _ => throw new Exception("Generating sequence is incorrect")
	        }
	      }
      } catch {
        case e: Throwable => throw new Exception("[signal " + signal._1 + "]" + e.getMessage())
      }
    }
    totalSignalsNum = index
  }
  
  /*
   * Generates the code describing the signals stored in variable signals
   */
  private def printSignals() = {
    append("\"data\": [")
    indent += 1
    for ((defName, signal) <- signals) {
      if (signal.genSeq == null) {
        append("{")
        indent += 1
        val resolvedArgs = signal.getResolvedArgs()
        resolvedArgs.find(Function.tupled((n, v) => n == "name")) match {
          case Some((n, v)) => append("\"name\": \"" + v + "\",")
          case _ => append("\"name\": \"" + defName + "\",")
        }
        for ((k, v) <- resolvedArgs.filterNot(Function.tupled((n,v) => n == "name"))) {
          append("\"" + k + "\": \"" + v + "\",")
        }
        removeLastComma()
        indent -= 1
        append("},")
      }
      else {
        var idx = 0
        for (elem <- signal.genSeq) {
          append("{")
          indent += 1
          val resolvedArgs = signal.getResolvedArgs(idx)
          resolvedArgs.find(Function.tupled((n, v) => n == "name")) match {
            case Some(Tuple2(n, v)) => append("\"name\": \"" + v + "\",")
            case _ => append("\"name\": \"" + defName + "\",")
          }
          for ((k, v) <- resolvedArgs.filterNot(Function.tupled((n,v) => n == "name"))) {
            append("\"" + k + "\": \"" + v + "\",")
          }
          removeLastComma()
          idx += 1
          indent -= 1
          append("},")
        }
      }
    }
    if (totalSignalsNum > 0) {
      removeLastComma()
    }
    indent -= 1
    append("],")
  }
  
  /*
   * Adds functions defined in section "functions" to variable functions
   */
  private def addFunctions() = {
    var index = 0
    if (wf.functions.distinct.size != wf.functions.size) {
      throw new Exception("Workflow functions have to be unique")
    }
    for((module: String, name: String) <- wf.functions) {
      functions += String.format("%s.%s", module, name) -> new Fun(module, name, index)
      index += 1
    }
    totalFunctionsNum = index
  }
  
  /*
   * Generates the code describing the functions stored in variable functions
   */
  private def printFunctions() = {
    append("\"functions\": [")
    indent += 1
    for ((_, Fun(module, name, _)) <- functions) {
      append("{")
      indent += 1
      append("\"name\": \"" + name + "\",")
      append("\"module\": \"" + module + "\"")
      indent -= 1
      append("},")
    }
    if (totalFunctionsNum > 0) {
      removeLastComma()
    }
    indent -= 1
    append("],")
  }
  
  /*
   * Adds tasks defined in section "tasks" to variable tasks
   */
  private def addTasks() = {
    var index = 0
    val taskNames: List[String] = wf.tasks map Function.tupled((_, name, _, _) => name)
    if (taskNames.distinct.size != taskNames.size) {
      throw new Exception("Task names have to be unique")
    }
    for(task <- wf.tasks) {
      try {
	      task match {
	        case (taskType, name, null, args) => {
	          tasks += name -> new Task(taskType, name, null, args, index, this)
	          index += 1
	        }
	        case (taskType, name, seq, args) => vars.get(seq) match {
	          case Some(l: List[Any]) => {
	            tasks += name -> new Task(taskType, name, l, args, index, this)
	            index += l.size
	          }
	          case _ => throw new Exception("The generating sequence is incorrect")
	        }
	      }
	    } catch {
        case e: Throwable => throw new Exception("[task " + task._2 + "]" + e.getMessage())
      }
    }
    totalTasksNum = index
  }
  
  /*
   * Generates the code describing the tasks stored in variable tasks
   */
  private def printTasks() = {
    append("\"tasks\": [")
    indent += 1
    for ((taskName, task) <- tasks) {
      if (task.genSeq == null) {
        append("{")
        indent += 1
        val resolvedArgs = task.getResolvedArgs()
        resolvedArgs.find(Function.tupled((n, v) => n == "name")) match {
          case Some((_, v: String)) => append("\"name\": \"" + v + "\",")
          case Some(_) => throw new Exception("Value of argument 'name' in task " + taskName + " has to evaluate to String")
          case None => append("\"name\": \"" + taskName + "\",")
        }
        append("\"type\": \"" + task.taskType + "\",")
        for ((k, v) <- resolvedArgs.filterNot(Function.tupled((n,v) => n == "name"))) {
          v match {
            case f: Fun => append(getFunctionStringForm(k, f))
            case _: String => append("\"" + k + "\": \"" + v + "\",")
          }
        }
        val insIndexes = task.getSignalsSpec("ins") map (simpleSignal => simpleSignal.globalIndex)
        append("\"ins\": [" + insIndexes.mkString(", ") + "],")
        val outsIndexes = task.getSignalsSpec("outs") map (simpleSignal => simpleSignal.globalIndex)
        append("\"outs\": [" + outsIndexes.mkString(", ") + "],")
        removeLastComma()
        indent -= 1
        append("},")
      }
      else {
        var idx = 0
        for (elem <- task.genSeq) {
          append("{")
          indent += 1
          val resolvedArgs = task.getResolvedArgs(idx)
          resolvedArgs.find(Function.tupled((n, v) => n == "name")) match {
	          case Some((_, v: String)) => append("\"name\": \"" + v + "\",")
	          case Some(_) => throw new Exception("Value of argument 'name' in task " + taskName + " has to evaluate to String")
	          case None => append("\"name\": \"" + taskName + "\",")
	        }
          append("\"type\": \"" + task.taskType + "\",")
          for ((k, v) <- resolvedArgs.filterNot(Function.tupled((n,v) => n == "name"))) {
	          v match {
	            case f: Fun => append(getFunctionStringForm(k, f))
	            case _: String => append("\"" + k + "\": \"" + v + "\",")
	          }
	        }
          val insIndexes = task.getSignalsSpec("ins", idx) map (simpleSignal => simpleSignal.globalIndex)
          append("\"ins\": [" + insIndexes.mkString(", ") + "],")
          val outsIndexes = task.getSignalsSpec("outs", idx) map (simpleSignal => simpleSignal.globalIndex)
          append("\"outs\": [" + outsIndexes.mkString(", ") + "],")
          removeLastComma()
          idx += 1
          indent -= 1
          append("},")
        }
      }
    }
    if (totalSignalsNum > 0) {
      removeLastComma()
    }
    indent -= 1
    append("],")
  }
  
  /*
   * Converts a function specification to a format set in Config
   * and generates its code. This method should be invoked while generating
   * code in other methods, as it immediately prints the results.
   */
  def getFunctionStringForm(varName: String, fun: Fun): String = {
    Config.functionGenerationStrategy match {
      case NAME_ONLY => "\"" + varName + "\": \"" + fun.name + "\","
  	  case MODULE_AND_NAME => "\"" + varName + "\": \"" + fun.module + "." + fun.name + "\","
  	  case ARRAY => "\"" + varName + "\": [" + fun.globalIndex + "],"
    }
  }
  
  /*
   * Evaluates the given Signal specification. Returns a list of
   * SimpleSignals because when the Signal is sequence-based it can
   * generate many SimpleSignals
   */
  def evalSignal(value: Any): List[SimpleSignal] = {
    value match {
      case Tuple1(name: String) => signals.get(name) match {
        case Some(s: Signal) => s match {
          case Signal(_, null, _, globalIndex, _) => List(SimpleSignal(globalIndex, s))
          case _ => throw new Exception("Cannot assign the sequence based signal " + name + " to a single port")
        }
        case None => throw new Exception("Undeclared signal " + name)
      }
      case Tuple2(Tuple1(name: String), null) => signals.get(name) match {
        case Some(s: Signal) => s match {
          case Signal(_, null, _, _, _) => throw new Exception("Cannot flatten a sequence in a non-sequence based signal " + name)
          case Signal(_, seq, _, globalIndex, _) => {
            val l = MutableList[SimpleSignal]()
            var index = 0
            for (elem <- seq) {
              l += SimpleSignal(globalIndex + index, s)
              index += 1
            }
            l.toList
          }
        }
        case None => throw new Exception("Undeclared signal " + name)
      }
      case Tuple2(Tuple1(name: String), unresolvedIndex) => signals.get(name) match {
        case Some(s: Signal) => s match {
          case Signal(_, null, _, _, _) => throw new Exception("Cannot access an index in a non-sequence based signal " + name)
          case Signal(_, seq, _, globalIndex, _) => {
            evalVar(unresolvedIndex) match {
              case index: Int => {
                if (seq.size <= index) throw new Exception("The index " + unresolvedIndex + " is equal to " + index + " and is out of bounds of the base-sequence of signal " + name + " of size " + seq.size)
                List(SimpleSignal(globalIndex + index, s))
              }
              case _ => throw new Exception("The index " + unresolvedIndex + " is not a variable of Int type in signal " + name)
            }
          }
        }
        case None => throw new Exception("Undeclared signal " + name)
      }
    }
  }
  
  /*
   * A wrapper for the evalSignal(value) method which enables one to
   * generate only one SimpleSignal if the Signal was sequence-based
   * and was index-accessed using the special "i" variable.
   */
  def evalSignal(value: Any, i: Int): List[SimpleSignal] = {
    vars += Config.identityVar -> i
    val res = evalSignal(value)
    vars -= Config.identityVar
    res
  }
  
  /*
   * Takes an ins/outs port of the workflow and returns its Signal
   * specification unfolded to SimpleSignal list.
   */
  def resolveInsOuts(io: List[Any]): List[SimpleSignal] = {
    try {
    	io.foldLeft(List[SimpleSignal]())((l, signalSpec) => l ++ evalSignal(signalSpec))
    } catch {
      case e: Throwable => throw new Exception("[ins/outs]" + e.getMessage())
    }
  }
  
  /*
   * Generates code for the appropriate ins/outs port of the workflow
   */
  def printInsOuts(ioName: String) = {
    val io = ioName match {
      case "ins" => ins
      case "outs" => outs
    }
    val indexes = io map (simpleSignal => simpleSignal.globalIndex)
    append("\"" + ioName + "\": [" + indexes.mkString(", ") + "],")
  }
  
  /*
   * Evaluates the "config" section parameters and generates code for them.
   */
  def printConfig() = {
    append("\"config\": {")
    indent += 1
    for ((name, value) <- wf.config) {
      try {
      	val tmp = (value map (x => evalVar(x))).mkString
      	append("\"" + name + "\": \"" + tmp + "\",")
      } catch {
        case e: Throwable => throw new Exception("[config " + name + "]" + e.getMessage())
      }
    }
    if (wf.config.size > 0) removeLastComma()
    indent -= 1
    append("},")
  }

  /*
   * Used to append the next line of code (passed in arguments "s")
   * to the generated code. Takes care of proper indentation and newlines.
   */
  private def append(s: String) = {
    out.append("\t" * indent)
    out.append(s)
    out.append("\n")
  }
  
  /*
   * Utility method used, when the previously processed JSON element was
   * the last one in it's block of code. For instance, normally all the methods
   * would generated a code like:
   * "task1": {
   *   "ins": "insSpec",
   *   "outs": "outSpec",
   *   "function": "functionSpec",
   * }
   * which is incorrect JSON because of the comma at the end of "function".
   * In such situations this method should be called at the end of task
   * generation to remove the additional comma.
   */
  private def removeLastComma() = {
    out.deleteCharAt(out.size-2)
  }
  
  /*
   * Purely for simple string parsing purposes in evalArgs()
   */
  case class ParseOp[T](op: String => T)
  implicit val popDouble = ParseOp[Double](_.toDouble)
  implicit val popInt = ParseOp[Int](_.toInt)
  def parse[T: ParseOp](s: String) = 
    try {
      Some(implicitly[ParseOp[T]].op(s)) 
    } catch {case _: Throwable => None}

}