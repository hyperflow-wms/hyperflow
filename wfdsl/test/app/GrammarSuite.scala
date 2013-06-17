package app

import org.junit.runner.RunWith
import org.scalatest.FunSuite
import app.Config.FunctionGenerationStrategy._
import org.scalatest.junit.JUnitRunner
import app.grammar.Grammar

@RunWith(classOf[JUnitRunner])
class GrammarSuite extends FunSuite {

  trait Tester extends Grammar {
  }

  test("Wf_valid_vars_test") {
    new Tester {
      val input = """
          	workflow grepFiles(size) {
    		vars:
    			a = 1
    			b = {1 to size}
    		  	c = {1 to 112}
    			d = {'a' to 'f' step a}
    			e = {0 to size}
    		  	f = a
    			seq1 = {"ala", "ola", "ela"}   
    			seq2 = {1, -1, 0, 7, 12}
    			seq3 = {'a', 'm', 'c'}
    			nested = seq3[first[second[third[n]]]]
    		  	nested = first1[second_2[_third_3[7]]]
    			empty = {}
    		config:
    		signals:
    		functions:
    		tasks:
    		ins:
    		outs:
      }
      """

      val parseRes = parseAll(workflow, input).successful
      assert(parseRes === true)
    }
  }

  test("Wf_invalid_vars_with empty string") {
    new Tester {
      val input = """
          	workflow grepFiles(size) {
    		vars:
    			empty = {"ala", "", "ola"}
    		config:
    		signals:
    		functions:
    		tasks:
    		ins:
    		outs:
      }
      """

      val parseRes = parseAll(workflow, input).successful
      assert(parseRes === false)
    }
  }

}