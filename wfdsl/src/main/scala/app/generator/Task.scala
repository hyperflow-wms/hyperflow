package app.generator

import app.Config

/*
 * Represents a Task, considered at the level of DSL.
 * All properties should be quite self-explanatory.
 * genSeq - generating sequence of this Task or null if it's a primitive Task
 * globalIndex - the "starting" index of this Task when converted to JSON.
 *   "Starting" means, that each primitive Task generated from this Task
 *   will be indexed as globalIndex + genSeq_index
 * generator - a reference to Generator providing access to some of its methods
 */
class Task(val taskType: String, val taskName: String, val genSeq: List[Any],
    private var args: List[(String, List[Any])],
    val globalIndex: Int, private val generator: Generator){
  
	checkArgsUniqueness()
	
  val ins = extractSignalsSpec("ins")
  val outs = extractSignalsSpec("outs")
  
  validatePorts()
  
  /*
   * Looks for arguments named "ins" and "outs" in args list, assigns them
   * to appropriate values and removes them from args
   */
  private def extractSignalsSpec(portName: String): List[Any] = {
    try {
	    args.find(Function.tupled((argName, argVal) => argName == portName)) match {
	      case Some((_, list)) => {
	      	args = args filterNot Function.tupled((argName, argVal) => argName == portName)
	      	list
	      }
	      case None => throw new Exception("Could not find " + portName)
	    }
    } catch {
	    case e: Throwable => throw new Exception("[task " + taskName + "]" + e.getMessage())
	  }
  }
  
	/* 
   * A method called on primitive Tasks only!
   * Gets the port name ("ins" or "outs") as an argument and returns
   * a list of SimpleSignals associated with this port. Resolves
   * all extant variables describing the Signals
   */
  def getSignalsSpec(portName: String): List[SimpleSignal] = {
    try {
	    if (genSeq != null) {
	      throw new Exception("The task is sequence-generated and " + 
	          "therefore you should invoke getSignalsSpec(portName, index)")
	    }
	    val port = portName match {
	      case "ins" => ins
	      case "outs" => outs
	    }
	    val simpleSignals = port.foldLeft(List[SimpleSignal]())((l, signalSpec) => l ++ generator.evalSignal(signalSpec))
	    addPortIdsToSignals(port, simpleSignals)
	    simpleSignals
	  } catch {
	    case e: Throwable => throw new Exception("[task " + taskName + "]" + e.getMessage())
	  }
  }
  
  /* 
   * A method called on sequence-based Tasks only!
   * Gets the port name ("ins" or "outs") as an argument 
   * and an innerIndex to access the specific primitive Task and returns
   * a list of SimpleSignals associated with this port. Resolves
   * all extant variables describing the Signals
   */
  def getSignalsSpec(portName: String, innerIndex: Int): List[SimpleSignal] = {
    try {
	    var res = List[SimpleSignal]()
	    if (genSeq == null) {
	      throw new Exception("The task is not sequence-generated and " + 
	          "therefore you should invoke getSignalsSpec(portName)")
	    }
	    if (innerIndex >= genSeq.size) {
	      throw new Exception("Cannot access index " + innerIndex +
	          " of the sequence, because the sequence only has size " + genSeq.size)
	    }
	    val port = portName match {
	      case "ins" => ins
	      case "outs" => outs
	    }
	    val simpleSignals = port.foldLeft(List[SimpleSignal]())((l, signalSpec) => l ++ generator.evalSignal(signalSpec, innerIndex))
	    addPortIdsToSignals(port, simpleSignals)
	    simpleSignals
	  } catch {
	    case e: Throwable => throw new Exception("[task " + taskName + "]" + e.getMessage())
	  }
  }
  
  /*
   * For each Signal in this Task's "outs" port, sets its portId
   * taking into account the natural order of declared port's Signals
   */
  def addPortIdsToSignals(port: List[Any], simpleSignals: List[SimpleSignal]) {
    try {
	    if (port == outs) {
	      var counter = 0
	      for (simpleSignal <- simpleSignals) {
	        val portId = counter
	        val localIndex = simpleSignal.globalIndex - simpleSignal.parent.globalIndex
	        simpleSignal.parent.portIds.get(localIndex) match {
	          case Some(`portId`) => {}
	          case Some(i: Int) => throw new Exception("[signal " + simpleSignal.parent.signalName + "(" + localIndex + ")]Signal used in an out port although it was assigned to an out port previously somewhere else")
	          case None => simpleSignal.parent.portIds += localIndex -> portId
	        }
	        counter += 1
	      }
	    }
	  } catch {
	    case e: Throwable => throw new Exception("[task " + taskName + "]" + e.getMessage())
	  }
  }
  
  /* 
   * A method called on primitive Tasks only!
   * For each Task argument converts its list of Strings and Tuples
   * to a single String by replacing variables with their values
   * Returns a list of arguments in format of (name, value)
   */
  def getResolvedArgs(): List[(String, Any)] = {
    try {
	    var res = List[(String, Any)]()
	    if (genSeq != null) {
	      throw new Exception("The task is sequence-generated and " + 
	          "therefore you should invoke getResolvedArgs(index)")
	    }
	    for ((name, value) <- args) {
	      var isFunction = false
	      val tmp = value map (x => x match {
	        case (module, function) => {
	          val fullFunctionName = generator.evalVar(module) + "." + generator.evalVar(function)
	          generator.functions.get(fullFunctionName) match {
	        	  case Some(f: Fun) => res = res :+ (name, f)
	        	  case None => throw new Exception("Reference to undeclared function " + fullFunctionName + " in task " + taskName)
	        	}
	          isFunction = true
	        }
	        case other => generator.evalVar(other)
	      })
	      if (!isFunction) res = res :+ (name, tmp.mkString)
	    }
	    res
	  } catch {
	    case e: Throwable => throw new Exception("[task " + taskName + "]" + e.getMessage())
	  }
  }
  
  /* 
   * A method called on sequence-based Tasks only!
   * Accesses the specific primitive Task using innerIndex variable.
   * For each Task argument converts its list of Strings and Tuples
   * to a single String by replacing variables with their values
   * Returns a list of arguments in format of (name, value)
   */
  def getResolvedArgs(innerIndex: Int): List[(String, Any)] = {
    try {
	    var res = List[(String, Any)]()
	    if (genSeq == null) {
	      throw new Exception("The task is not sequence-generated and " + 
	          "therefore you should invoke getResolvedArgs()")
	    }
	    if (innerIndex >= genSeq.size) {
	      throw new Exception("Cannot access index " + innerIndex +
	          " of the sequence, because the sequence only has size " + genSeq.size)
	    }
	    for ((name, value) <- args) {
	      var isFunction = false
	      val tmp = value map (x => x match {
	        case (module, function) => {
	          val fullFunctionName = generator.evalVar(module, Map(Config.identityVar->innerIndex)) + "." + generator.evalVar(function, Map(Config.identityVar->innerIndex))
	          generator.functions.get(fullFunctionName) match {
	        	  case Some(f: Fun) => res = res :+ (name, f)
	        	  case None => throw new Exception("Reference to undeclared function " + fullFunctionName + " in task " + taskName)
	        	}
	          isFunction = true
	        }
	        case other => generator.evalVar(other, Map(Config.identityVar->innerIndex))
	      })
	      if (!isFunction) res = res :+ (name, tmp.mkString)
	    }
	    res
	  } catch {
	    case e: Throwable => throw new Exception("[task " + taskName + "]" + e.getMessage())
	  }
  }
  
  /*
   * Checks, whether the arguments of the Task are uniquely named.
   */
  private def checkArgsUniqueness() {
    try {
	    val argsNames = args map Function.tupled((name, _) => name)
	    if (argsNames.distinct.size != argsNames.size) {
	      throw new Exception("Task " + taskName + ": task arguments have to be uniquely named")
	    }
    } catch {
	    case e: Throwable => throw new Exception("[task " + taskName + "]" + e.getMessage())
	  }
  }
  
  /*
   * Called after extracting ins/outs ports of the Task. Calls the user-defined
   * method Config.validatePorts
   */
  private def validatePorts() {
	  genSeq match {
	    case null => Config.validatePorts(this, getSignalsSpec("ins"), getSignalsSpec("outs"))
	    case _ => {
	      for (index <- 0 until genSeq.size) {
	      	Config.validatePorts(this, getSignalsSpec("ins", index), getSignalsSpec("outs", index))
	      }    
	    }
	  }
  }

}