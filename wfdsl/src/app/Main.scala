package app

import scala.util.parsing.combinator._
import app.generator.Generator
import app.element.Workflow

object Main extends Grammar {
  def main(args: Array[String]) {
    val arg = """
	    		workflow WF_sqrsum(size) {
	    			vars:
	    				gen = {1 to size}
    				config:
	    			signals:
	    				arg[gen] {
	    					name = "arg${gen[i]}"
	    				}
	    				sqr[gen] {
	    					name = "sqr${gen[i]}"
	    				}
	    				sum
	    			functions:
	    				functions.add
	    				functions.sqr
	    			tasks:
	    				foreach Sqr {
	    					function = functions.sqr
	    					ins = *arg 
	    					outs = *sqr
	    				}
	    				task Add {
	    					function = functions.add
	    					ins = *sqr
	    					outs = sum
	    				}
    				ins: *arg
    				outs: sum
	    		}
	    		"""

    val parseRes = parseAll(workflow, arg)
    println(parseRes)
    val wf = parseRes.get

    try {
      val output = new Generator(wf).generate(List("3"))
      println(output)
    } catch {
      case e: Exception => e.printStackTrace()
    }
  }
}
