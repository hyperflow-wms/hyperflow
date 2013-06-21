package app

import app.generator.SimpleSignal
import app.generator.Task

/*
 * Use the constants stored here as parameters of the compiler.
 * After changing anything, a recompilation is required.
 */
object Config {

  /*
   * Generation strategies for referencing functions in Tasks.
   * NAME ONLY - reference only by function's name
   * MODULE_AND_NAME - reference the full name of the function, 
   *   e.g. "myfunctions.fun1"
   * ARRAY - reference the function by its index (defaulting to
   *   the order of declarations in section "functions")
   */
  object FunctionGenerationStrategy extends Enumeration {
    type FunctionGenerationStrategy = Value
    val NAME_ONLY, MODULE_AND_NAME, ARRAY = Value
  }
  import FunctionGenerationStrategy._
  
  /*
   * Set the appropriate function generation strategy
   */
  val functionGenerationStrategy = NAME_ONLY
  
  /*
   * Special variables.
   * identityVar - used to obtain the index of the current
   *   primitive Task/Signal derived form a sequence-based Task/Signal
   * portIdVar - used to obtain the number of the Signal
   *   in the "outs" port of its Task
   * 
   * You should add those and any new variables to reservedVarsNames
   * to prevent users from declaring those variables in the "vars" section
   */
  val identityVar = "i"
  val portIdVar = "portId"
  val reservedVarsNames = Set(identityVar, portIdVar)

  /*
   * Fill in this method to implement Tasks ins/outs ports validation.
   * This method is called after creation of every Task. Feel free to
   * throw Exceptions to interrupt compilation of an invalid DSL.
   */
  def validatePorts(task: Task, ins: List[SimpleSignal], outs: List[SimpleSignal]) = {
//    if (ins.size == 0) throw new Exception("There are no ins ports in task " + task.taskName)
//    if (outs.size == 0) throw new Exception("There are no outs ports in task " + task.taskName)
  }
}