package app.generator

class Task(val taskType: String, val taskName: String, val genSeq: List[Any],
    private var args: List[(String, List[Any])],
    val globalIndex: Int, private val generator: Generator){
  
  checkArgsUniqueness()
  
  val ins: List[Any] = extractSignalsSpec("ins")
  val outs: List[Any] = extractSignalsSpec("outs")
  
  private def extractSignalsSpec(portName: String): List[Any] = {
    args.find(Function.tupled((argName, argVal) => argName == portName)) match {
      case Some((_, list)) => {
      	args = args filterNot Function.tupled((argName, argVal) => argName == portName)
      	list
      }
      case None => throw new Exception("Could not find " + portName + " in task " + taskName)
    }
  }
  
  def getSignalsSpec(portName: String): List[SimpleSignal] = {
    if (genSeq != null) {
      throw new Exception("task " + taskName + ": the task is sequence-generated and " + 
          "therefore you should invoke getSignalsSpec(portName, index)")
    }
    val port = portName match {
      case "ins" => ins
      case "outs" => outs
    }
    port.foldLeft(List[SimpleSignal]())((l, signalSpec) => l ++ generator.evalSignal(signalSpec))
  }
  
  def getSignalsSpec(portName: String, innerIndex: Int): List[SimpleSignal] = {
    var res = List[SimpleSignal]()
    if (genSeq == null) {
      throw new Exception("task " + taskName + ": the task is not sequence-generated and " + 
          "therefore you should invoke getSignalsSpec(portName)")
    }
    if (innerIndex >= genSeq.size) {
      throw new Exception("task " + taskName + ": cannot access index " + innerIndex +
          " of the sequence, because the sequence only has size " + genSeq.size)
    }
    val port = portName match {
      case "ins" => ins
      case "outs" => outs
    }
    port.foldLeft(List[SimpleSignal]())((l, signalSpec) => l ++ generator.evalSignal(signalSpec, innerIndex))
  }
  
  /* 
   * Resolves the args for a non-sequence based task
   */
  def getResolvedArgs(): List[(String, String)] = {
    var res = List[(String, String)]()
    if (genSeq != null) {
      throw new Exception("task " + taskName + ": the task is sequence-generated and " + 
          "therefore you should invoke getResolvedArgs(index)")
    }
    args map Function.tupled((name, value) => (name, value.mkString))
    for ((name, value) <- args) {
      val tmp = value map (x => x match {
        case (module, function) => {
          val fullFunctionName = generator.evalVar(module) + "." + generator.evalVar(function)
          if (!generator.functions.contains(fullFunctionName)) throw new Exception("Reference to undeclared function " + fullFunctionName + " in task " + taskName)
          fullFunctionName
        }
        case other => generator.evalVar(other)
      })
      res = res :+ (name, tmp.mkString)
    }
    res
  }
  
  /*
   * Resolves all args for a sequence based task. Thanks to the innerIndex
   * it is possible to resolve the "i" variable
   */
  def getResolvedArgs(innerIndex: Int): List[(String, String)] = {
    var res = List[(String, String)]()
    if (genSeq == null) {
      throw new Exception("task " + taskName + ": the task is not sequence-generated and " + 
          "therefore you should invoke getResolvedArgs()")
    }
    if (innerIndex >= genSeq.size) {
      throw new Exception("task " + taskName + ": cannot access index " + innerIndex +
          " of the sequence, because the sequence only has size " + genSeq.size)
    }
    for ((name, value) <- args) {
      val tmp = value map (x => x match {
        case (module, function) => {
          val fullFunctionName = generator.evalVar(module, innerIndex) + "." + generator.evalVar(function, innerIndex)
          if (!generator.functions.contains(fullFunctionName)) throw new Exception("Reference to undeclared function " + fullFunctionName + " in task " + taskName)
          fullFunctionName
        }
        case other => generator.evalVar(other, innerIndex)
      })
      res = res :+ (name, tmp.mkString)
    }
    res
  }
  
  private def checkArgsUniqueness() {
    val argsNames = args map Function.tupled((name, _) => name)
    if (argsNames.distinct.size != argsNames.size) {
      throw new Exception("Task " + taskName + ": task arguments have to be uniquely named")
    }
  }

}