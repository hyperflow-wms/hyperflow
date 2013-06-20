package app

import org.junit.runner.RunWith
import org.scalatest.FunSuite
import org.scalatest.junit.JUnitRunner
import app.generator.Generator
import app.Config.FunctionGenerationStrategy._
import app.grammar.Grammar

@RunWith(classOf[JUnitRunner])
class GeneratorSuite extends FunSuite {

  trait Tester extends Grammar {
  }

  test("Wf_sqrsum") {
    new Tester {
      val generatorInput = """
	    		workflow Wf_sqrsum(size) {
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
      val parseRes = parseAll(workflow, generatorInput)
      val wf = parseRes.get
      val generatorOutput = new Generator(wf).generate(List("3"))

      val handmadeInput = """
        	{
      			"name": "Wf_sqrsum",
        		"config": {
      			},
      			"functions": [ {
      				"name": "add",
      				"module":"functions"
      			}, {
      				"name": "sqr",
      				"module":"functions"
      			} ],
      			"tasks": [ {
      				"name": "Sqr",
      				"type": "foreach",
      """ + {
        Config.functionGenerationStrategy match {
          case NAME_ONLY => """"function": "sqr","""
          case MODULE_AND_NAME => """"function": "functions.sqr","""
          case ARRAY => """"function": [1],"""
        }
      } + """
							"ins": [ 0, 1, 2 ],
							"outs": [ 3, 4, 5 ]
      			}, {
							"name": "Add",
							"type": "task",
    	""" + {
        Config.functionGenerationStrategy match {
          case NAME_ONLY => """"function": "add","""
          case MODULE_AND_NAME => """"function": "functions.add","""
          case ARRAY => """"function": [0],"""
        }
      } + """
							"ins": [ 3, 4, 5 ],
							"outs": [ 6 ]
      			} ],
      			"data": [ {
							"name": "arg1"
						}, {
							"name": "arg2"
						}, {
							"name": "arg3"
						}, {
							"name": "sqr1"
						}, {
							"name": "sqr2"
						}, {
							"name": "sqr3"
						}, {
							"name": "sum"
						} ],
      			"ins": [ 0, 1, 2 ],
      			"outs": [ 6 ]
      		}
        	"""
      val strippedGeneratorOutput = generatorOutput.replaceAll("\\s", "")
      val strippedHandmadeInput = handmadeInput.replaceAll("\\s", "")
      //      println(strippedGeneratorOutput)
      //      println(strippedHandmadeInput)
      assert(strippedGeneratorOutput === strippedHandmadeInput)
    }

  }

  test("Wf_seq_index_out_of_bounds") {
    new Tester {
      val size = "5"
      val generatorInput = """
	    		workflow Wf_sqrsum(size) {
	    			vars:
	    				gen = {1 to size}
    				config:
	    			signals:
	    				arg[gen] {
	    					name = "arg${gen[""" + size + """]}"
	    				}
	    				sum
	    			functions:
	    			tasks:
    				ins:
    				outs:
	    		}
	    		"""
      val parseRes = parseAll(workflow, generatorInput)
      val wf = parseRes.get
      // Exception could be more specific (e.g. SeqIndexOutOfBound):
      intercept[Exception] {
        val generatorOutput = new Generator(wf).generate(List(size))
      }
    }
  }

  test("Wf_illegal_portId_variable") {
    new Tester {
      val size = "5"
      val generatorInput = """
	    		workflow Wf_sqrsum(size) {
	    			vars:
	    				gen = {1 to size}
        				portId = {1 to 4}
    				config:
	    			signals:
	    				arg[gen] {
	    					name = "arg${gen[i]}"
	    				}
	    				sum
	    			functions:
	    			tasks:
    				ins:
    				outs:
	    		}
	    		"""
      val parseRes = parseAll(workflow, generatorInput)
      val wf = parseRes.get
      intercept[Exception] {
        val generatorOutput = new Generator(wf).generate(List(size))
      }
    }
  }

  test("Wf_illegal_i_variable") {
    new Tester {
      val size = "5"
      val generatorInput = """
	    		workflow Wf_sqrsum(size) {
	    			vars:
	    				gen = {1 to size}
        				i = {"one", "two", "three"}
    				config:
	    			signals:
	    				arg[gen] {
	    					name = "arg${gen[i]}"
	    				}
	    				sum
	    			functions:
	    			tasks:
    				ins:
    				outs:
	    		}
	    		"""
      val parseRes = parseAll(workflow, generatorInput)
      val wf = parseRes.get
      intercept[Exception] {
        val generatorOutput = new Generator(wf).generate(List(size))
      }
    }
  }

  test("Wf_seq_without_asterisk") {
    new Tester {
      val size = "5"
      val generatorInput = """
	    		workflow Wf_sqrsum(size) {
	    			vars:
	    				gen = {1 to size}
    				config:
	    			signals:
	    				arg[gen] {
	    					name = "arg${gen[i]}"
	    				}
	    				sum
	    			functions:
	    			tasks:
    				ins: arg
    				outs:
	    		}
	    		"""
      val parseRes = parseAll(workflow, generatorInput)
      val wf = parseRes.get
      intercept[Exception] {
        val generatorOutput = new Generator(wf).generate(List(size))
      }
    }
  }

  test("Wf_portId_test") {
    new Tester {
      val size = "4"
      val generatorInput = """
	    		workflow Wf_sqrsum(size) {
	    			vars:
	    				gen = {1 to size}
    				config:
	    			signals:
	    				arg[gen] {
	    					name = "arg${gen[i]}"
	    				}
	    				sqr[gen] {
	    					name = "name_test${portId}"
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
    				ins: *arg
    				outs: sum
	    		}
	    		"""

      val substrPrefix = """
          {
			"name": "name_test"""

      val substrSuffix = """"
          },
          """

      val substrToMatch = (0 until size.toInt).foldRight("")(substrPrefix + _ + substrSuffix + _)

      val parseRes = parseAll(workflow, generatorInput)
      val wf = parseRes.get
      val generatorOutput = new Generator(wf).generate(List(size))

      val strippedGeneratorOutput = generatorOutput.replaceAll("\\s", "")
      val strippedSubstrToMatch = substrToMatch.replaceAll("\\s", "")
      assert((strippedGeneratorOutput contains strippedSubstrToMatch) === true)
    }
  }

}