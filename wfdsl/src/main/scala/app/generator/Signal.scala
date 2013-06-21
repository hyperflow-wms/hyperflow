package app.generator

import app.Config

/*
 * Represents a Signal, considered at the level of DSL.
 * All properties should be quite self-explanatory.
 * genSeq - generating sequence of this Signal or null if it's a primitive Signal
 * globalIndex - the "starting" index of this Signal when converted to JSON.
 *   "Starting" means, that each SimpleSignal generated from this Signal
 *   will be indexed as globalIndex + genSeq_index
 * generator - a reference to Generator providing access to some of its methods
 */
case class Signal(val signalName: String, val genSeq: List[Any], 
    private val args: List[(String, List[Any])], 
    val globalIndex: Int, private val generator: Generator) {
  
  checkArgsUniqueness()
  
  /*
   * maps Signal(index) to its portId; if the Signal is not
   * sequence based then its portId is under index 0
   */
  val portIds = scala.collection.mutable.Map[Int, Int]()

  /* 
   * A method called on primitive Signals only!
   * For each Signal argument converts its list of Strings and Tuples
   * to a single String by replacing variables with their values
   * Returns a list of arguments in format of (name, value)
   */
  def getResolvedArgs(): List[(String, String)] = {
    try {
      var res = List[(String, String)]()
	    if (genSeq != null) {
	      throw new Exception("The signal is sequence-generated and " + 
	          "therefore you should invoke getResolvedArgs(index)")
	    }    
	    for ((name, value) <- args) {
	      val tmp = value map (v => portIds.get(0) match {
	          case Some(portId) => generator.evalVar(v, Map(Config.portIdVar->portId))
	          case None => generator.evalVar(v)
	      })
	      res = res :+ (name, tmp.mkString)
	    }
	    res
	  } catch {
      case e: Throwable => throw new Exception("[signal " + signalName + "]" + e.getMessage())
    }
  }
  
  /* 
   * A method called on sequence-based Signals only!
   * Accesses the specific primitive Signal using innerIndex variable.
   * For each Signal argument converts its list of Strings and Tuples
   * to a single String by replacing variables with their values
   * Returns a list of arguments in format of (name, value)
   */
  def getResolvedArgs(innerIndex: Int): List[(String, String)] = {
    try {
	    var res = List[(String, String)]()
	    if (genSeq == null) {
	      throw new Exception("The signal is not sequence-generated and " + 
	          "therefore you should invoke getResolvedArgs()")
	    }
	    if (innerIndex >= genSeq.size) {
	      throw new Exception("Cannot access index " + innerIndex +
	          " of the sequence, because the sequence only has size " + genSeq.size)
	    }    
	    for ((name, value) <- args) {
	      val tmp = value map (v => portIds.get(innerIndex) match {
	          case Some(portId) => generator.evalVar(v, Map(Config.identityVar->innerIndex, Config.portIdVar->portId))
	          case None => generator.evalVar(v, Map(Config.identityVar->innerIndex))
	      })
	      res = res :+ (name, tmp.mkString)
	    }
	    res
    } catch {
      case e: Throwable => throw new Exception("[signal " + signalName + "]" + e.getMessage())
    }
  }
  
  /*
   * Checks, whether the arguments of the Signal are uniquely named.
   */
  private def checkArgsUniqueness() {
    try {
	    val argsNames = args map Function.tupled((name, _) => name)
	    if (argsNames.distinct.size != argsNames.size) {
	      throw new Exception("Signal arguments have to be uniquely named")
	    }
	  } catch {
      case e: Throwable => throw new Exception("[signal " + signalName + "]" + e.getMessage())
    }
  }
  
}