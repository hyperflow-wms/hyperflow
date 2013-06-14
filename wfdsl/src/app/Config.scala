package app

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

}