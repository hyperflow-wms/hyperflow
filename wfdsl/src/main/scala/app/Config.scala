package app

import app.generator.SimpleSignal
import app.generator.Task

object Config {

  object FunctionGenerationStrategy extends Enumeration {
    type FunctionGenerationStrategy = Value
    val NAME_ONLY, MODULE_AND_NAME, ARRAY = Value
  }
  import FunctionGenerationStrategy._
  
  val functionGenerationStrategy = NAME_ONLY
  
  val identityVar = "i"
  val portIdVar = "portId"
  val reservedVarsNames = Set(identityVar, portIdVar)

  /*
   * Fill in this method, it'll validate every newly created Task
   */
  def validatePorts(task: Task, ins: List[SimpleSignal], outs: List[SimpleSignal]) = {
//    if (ins.size == 0) throw new Exception("There are no ins ports in task " + task.taskName)
//    if (outs.size == 0) throw new Exception("There are no outs ports in task " + task.taskName)
  }
}