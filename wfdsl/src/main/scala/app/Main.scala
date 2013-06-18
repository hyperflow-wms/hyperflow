package app

import scala.util.parsing.combinator._
import app.generator.Generator
import app.grammar.Workflow
import app.grammar.Grammar

object Main extends Grammar {
  def main(args: Array[String]) {
    val arg = """
    	workflow grepFiles(size) {
    		vars:
    			a = 1
    			n = {1 to size}
    			m = {'a' to 'f' step a}
    			p = {0 to size}
    			seq1 = {"ala", "ola", "ela"}   
    			seq2 = {1, -1, 0}
    			seq3 = {'a', 'm', 'c'}
    			tmp = seq3[n[a]]
    			tmp2 = {}
    		config:
    			workdir = "hej"
    			test = "${seq3[n[a]]}"
    		signals:
    			tmpSig[seq3]
    			aSignal
    			bSignal {
    				one = "one ${tmp} three"
    				portId = "${seq3[10]}"
    			}
    			next[n] {
    				one = "one ${tmp} three"
      		}
    			back[m] {
    				name = "customName"
    				numbers = "six ${seq3[n[a]]} three"
    				test = "${m[i]}"
    				test2 = "${seq3[1]}"
      		}
    		functions:
    			functions.scanDirForJs
    			functions.fileSplitter
    			functions.grepFile
    		tasks:
    			foreach DirScanner {
    				function = functions.scanDirForJs
    				ins = *tmpSig
    				outs = next[0]
    				__comment = "komentarz"
    			}
    			splitter LineEmitter[n] {
            function = functions.fileSplitter
    				ins = back[n[i]], aSignal, *next
    				outs = *next, bSignal
    				test = "${m[n[i]]}"
    			}

    		ins: *back
    		outs: next[1]
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
