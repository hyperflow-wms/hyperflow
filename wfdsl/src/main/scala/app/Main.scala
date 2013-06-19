package app

import scala.util.parsing.combinator._
import app.generator.Generator
import app.grammar.Workflow
import app.grammar.Grammar
import java.io.File

object Main extends Grammar {
  def main(args: Array[String]) {
    if (args.size < 2) {
      println("\nUsage:\n" +
          "run SOURCE_FILE OUTPUT_FILE [WORKFLOW_ARGUMENTS]\n")
      return;
    }

    try {
	    val source = scala.io.Source.fromFile(args(0))
			val lines = source.mkString
			source.close()
	
	    val parseRes = parseAll(workflow, lines)
	    println("\n" + parseRes)
	    val wf = parseRes.get
	    
      val output = new Generator(wf).generate(args.drop(2).toList)
      printToFile(new File(args(1)), output)      
    } catch {
      case e: Exception => println("\nEXCEPTION!!!\n" + e.getMessage() + "\n")
    }
  }
  
  private def printToFile(f: java.io.File, out: String) {
	  val p = new java.io.PrintWriter(f)
	  try { 
	    p.print(out)
	  } finally { 
	    p.close() 
	  }
  }
}
