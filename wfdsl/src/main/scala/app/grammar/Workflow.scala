package app.grammar

import scala.collection.immutable.List
import scala.collection.mutable.ListBuffer

class Workflow(val name: String, val args: List[String]) {

  /*
   * [(name, value)]
   * value -> const | (other_var) | (seq, index)
   */
  var vars = List[Tuple2[String, Any]]()

  /*
   * [(attribute_name, value)]
   */
  var config = List[(String, List[Any])]()

  /*
   * [(name, sequence_name or null, [(attribute_name, value)])]
   */
  var signals = List[(String, String, List[(String, List[Any])])]()

  /*
   * [(package, function_name)]
   */
  var functions = List[(String, String)]()

  /*
   * [(type, name, sequence_name or null, [(attribute_name, right-hand-side)])]
   * right-hand-side -> string (may be interleaved with vars) |
   *                    List[Signal-def] for ins and outs
   * Signal-def -> (signal_name) | (signal_seq, null) | (signal_seq, index)
   */
  var tasks = List[(String, String, String, List[(String, List[Any])])]()

  var ins = List[Any]()

  var outs = List[Any]()

  def addVars(range: List[Tuple2[String, Any]]) = {
    this.vars = range
    this
  }

  def addConfig(config: List[(String, List[Any])]) = {
    this.config = config
    this
  }

  def addSignals(signals: List[(String, String, List[(String, List[Any])])]) = {
    this.signals = signals
    this
  }

  def addFunctions(functions: List[(String, String)]) = {
    this.functions = functions
    this
  }

  def addTasks(tasks: List[(String, String, String, List[(String, List[Any])])]) = {
    this.tasks = tasks
    this
  }

  def addIns(ins: List[Any]) = {
    this.ins = ins
    this
  }

  def addOuts(outs: List[Any]) = {
    this.outs = outs
    this
  }

}
