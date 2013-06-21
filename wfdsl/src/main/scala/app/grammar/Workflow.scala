package app.grammar

import scala.collection.immutable.List
import scala.collection.mutable.ListBuffer

/*
 * The class representing the parsed DSL workflow specification.
 * General assumptions:
 * const is any constant, that means:
 *   - String, e.g. "string"
 *   - Char, e.g. 'a'
 *   - Integer or Double, eg. 5, 3.14
 * Generally, any reference to a variable or a Signal is enclosed
 * in a Tuple. So (varName) means that it's a variable varName.
 * The notion (varName, varIndex) is used with Sequences and
 * sequence-based to access a single element of the Sequence varName
 * identified by the index varIndex.
 * Variables can be freely nested, so it's perfectly correct to have
 * ((seq1), ((seq2), (n))) which in C-notion would translate to seq1[seq2[n]]
 * 
 * Usually, when a "value" is referenced in comments it means that either
 * a const, a variable or a indexed-variable (Tuple2) can be passed
 * as an argument.
 * 
 * A "svalue" (string value) is a String interleaved with variables,
 * e.g. "aaa ${var1} bbb ${var2}"
 * This is represented as a list of interleaved Strings and Tuples,
 * for this example it would be:
 * List("aaa ", (var1), " bbb ", (var2))
 * The values in tuples are later dereferenced and concatenated in order to
 * create a single String
 */
class Workflow(val name: String, val args: List[String]) {

  /*
   * [(NAME, VALUE)]
   * A list of variables (section "vars"), each named NAME of value VALUE
   */
  var vars = List[Tuple2[String, Any]]()

  /*
   * [(NAME, VALUE)]
   * A list of config settings (section "config"), each named NAME of value VALUE
   */
  var config = List[(String, List[Any])]()

  /*
   * [(NAME, SEQUENCE_NAME or null, [(ATTRIBUTE_NAME, SVALUE)])]
   * A list of Signals (section "signals"). Every single Signal is named NAME
   * and may be sequence-based (SEQUENCE_NAME references the base Sequence)
   * or primitive (null as the second element of the tuple).
   * There's a list assigned with each signal (third element of the tuple),
   * which contains attributes named ATTRIBUTE_NAME and svalues associated
   * with them - SVALUE.
   */
  var signals = List[(String, String, List[(String, List[Any])])]()

  /*
   * [(MODULE, NAME)]
   * A list of functions (section "functions"). Just a simple list of tuples,
   * whose elements represent a MODULE and a NAME of the function.
   */
  var functions = List[(String, String)]()

  /*
   * [(TYPE, NAME, SEQUENCE_NAME or null, [(ATTRIBUTE_NAME, ATTRIBUTE_VALUE)])]
   * A list of Tasks (section "tasks"). TYPE is the type of the Task, e.g. splitter.
   * NAME is the name of the task. Just as Signals, Tasks can be sequence-based or
   * primitive. The fourth element of the tuple is a list of Task's attributes.
   * ATTRIBUTE_VALUE can either be:
   *   - SVALUE - normal attributes
   *   - a list of Signal references, in case of "ins" and "outs" of the Task
   */
  var tasks = List[(String, String, String, List[(String, List[Any])])]()

  /*
   * "ins" of the whole workflow. Just a list of Signal references.
   */
  var ins = List[Any]()

  /*
   * "outs" of the whole workflow. Description as above.
   */
  var outs = List[Any]()

  /*
   * Utility methods used in Grammar, not called elsewhere.
   */
  
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
