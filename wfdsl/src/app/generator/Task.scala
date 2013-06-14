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
    val simpleSignals = port.foldLeft(List[SimpleSignal]())((l, signalSpec) => l ++ generator.evalSignal(signalSpec))
    addPortIdsToSignals(port, simpleSignals)
    simpleSignals
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
    val simpleSignals = port.foldLeft(List[SimpleSignal]())((l, signalSpec) => l ++ generator.evalSignal(signalSpec, innerIndex))
    addPortIdsToSignals(port, simpleSignals)
    simpleSignals
  }
  
  def addPortIdsToSignals(port: List[Any], simpleSignals: List[SimpleSignal]) {
    if (port == outs) {
      var counter = 0
      for (simpleSignal <- simpleSignals) {
        val portId = counter
        val localIndex = simpleSignal.globalIndex - simpleSignal.parent.globalIndex
        simpleSignal.parent.portIds.get(localIndex) match {
          case Some(`portId`) => {}
          case Some(i: Int) => throw new Exception("[task " + taskName + "][signal " + simpleSignal.parent.signalName + "(" + localIndex + ")]Signal used in an out port although it was assigned to an out port previously somewhere else")
          case None => simpleSignal.parent.portIds += localIndex -> portId
        }
        counter += 1
      }
    }
  }
  
  /* 
   * Resolves the args for a non-sequence based task
   */
  def getResolvedArgs(): List[(String, Any)] = {
    var res = List[(String, Any)]()
    if (genSeq != null) {
      throw new Exception("task " + taskName + ": the task is sequence-generated and " + 
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
  }
  
  /*
   * Resolves all args for a sequence based task. Thanks to the innerIndex
   * it is possible to resolve the "i" variable
   */
  def getResolvedArgs(innerIndex: Int): List[(String, Any)] = {
    var res = List[(String, Any)]()
    if (genSeq == null) {
      throw new Exception("task " + taskName + ": the task is not sequence-generated and " + 
          "therefore you should invoke getResolvedArgs()")
    }
    if (innerIndex >= genSeq.size) {
      throw new Exception("task " + taskName + ": cannot access index " + innerIndex +
          " of the sequence, because the sequence only has size " + genSeq.size)
    }
    for ((name, value) <- args) {
      var isFunction = false
      val tmp = value map (x => x match {
        case (module, function) => {
          val fullFunctionName = generator.evalVar(module, Map("i"->innerIndex)) + "." + generator.evalVar(function, Map("i"->innerIndex))
          generator.functions.get(fullFunctionName) match {
        	  case Some(f: Fun) => res = res :+ (name, f)
        	  case None => throw new Exception("Reference to undeclared function " + fullFunctionName + " in task " + taskName)
        	}
          isFunction = true
        }
        case other => generator.evalVar(other, Map("i"->innerIndex))
      })
      if (!isFunction) res = res :+ (name, tmp.mkString)
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