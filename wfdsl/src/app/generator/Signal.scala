package app.generator

case class Signal(val signalName: String, val genSeq: List[Any], 
    private val args: List[(String, List[Any])], 
    val globalIndex: Int, private val generator: Generator) {
  
  checkArgsUniqueness()

  /* 
   * Resolves the args for a non-sequence based signal
   */
  def getResolvedArgs(): List[(String, String)] = {
    if (genSeq != null) {
      throw new Exception("signal " + signalName + ": the signal is sequence-generated and " + 
          "therefore you should invoke getResolvedArgs(index)")
    }
    args map Function.tupled((name, value) => (name, value.mkString))
  }
  
  /*
   * Resolves all args for a sequence based signal. Thanks to the innerIndex
   * it is possible to resolve the "i" variable
   */
  def getResolvedArgs(innerIndex: Int): List[(String, String)] = {
    var res = List[(String, String)]()
    if (genSeq == null) {
      throw new Exception("signal " + signalName + ": the signal is not sequence-generated and " + 
          "therefore you should invoke getResolvedArgs()")
    }
    if (innerIndex >= genSeq.size) {
      throw new Exception("signal " + signalName + ": cannot access index " + innerIndex +
          " of the sequence, because the sequence only has size " + genSeq.size)
    }
    for ((name, value) <- args) {
      val tmp = value map (x => x match {
        case s: String => s
        case other => generator.evalVar(other, innerIndex)
      })
      res = res :+ (name, tmp.mkString)
    }
    res
  }
  
  private def checkArgsUniqueness() {
    val argsNames = args map Function.tupled((name, _) => name)
    if (argsNames.distinct.size != argsNames.size) {
      throw new Exception("Signal " + signalName + ": signal arguments have to be uniquely named")
    }
  }
  
}