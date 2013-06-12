package app

object Config {

  object FunctionGenerationStrategy extends Enumeration {
    type FunctionGenerationStrategy = Value
    val NAME_ONLY, MODULE_AND_NAME, ARRAY = Value
  }
  import FunctionGenerationStrategy._
  
  val functionGenerationStrategy = MODULE_AND_NAME

}