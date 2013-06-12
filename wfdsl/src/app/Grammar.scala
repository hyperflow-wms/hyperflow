package app

import scala.util.parsing.combinator.JavaTokenParsers
import app.element.Workflow
import app.element.Sequence

class Grammar extends JavaTokenParsers {

  def workflow: Parser[Workflow] =
    "workflow " ~> simpleStr ~ arguments ~ workflowBody ^^ {
      case name ~ args ~ blocks =>
        new Workflow(name, args) addVars blocks._1 addConfig blocks._2 addSignals blocks._3 addFunctions blocks._4 addTasks blocks._5 addIns blocks._6 addOuts blocks._7
    }

  def arguments =
    "(" ~> repsep(simpleStr, ",") <~ ")"

  def workflowBody =
    "{" ~> vars ~ config ~ signals ~ functions ~ tasks ~ ins ~ outs <~ "}" ^^ {
      case vars ~ config ~ signals ~ functions ~ tasks ~ ins ~ outs =>
        (vars, config, signals, functions, tasks, ins, outs)
    }

  def vars =
    "vars:" ~> rep(varsBody)

  /* Vars */

  def varsBody =
    ident ~ (varSeqElem | varDef | rangeDef | seqDef) ^^ { case name ~ values => (name, values) }

  def varDef =
    "=" ~> (varSeqElemValue | str | char | decimal | float | variable)

  def variable =
    simpleStr ^^ { case variable => Tuple1(variable) }

  def rangeDef =
    range | rangeStep

  def range =
    "=" ~> "{" ~> valOrVar ~ "to" ~ valOrVar <~ "}" ^^ { case from ~ _ ~ to => Sequence(from, to) }

  def rangeStep =
    "=" ~> "{" ~> valOrVar ~ "to" ~ valOrVar ~ "step" ~ decOrVar <~ "}" ^^ { case from ~ _ ~ to ~ _ ~ step => Sequence(from, to, step) }

  def valOrVar =
    decimal | char | variable

  def decOrVar =
    decimal | variable

  def seqDef =
    "=" ~> "{" ~> repsep(seqElem, ",") <~ "}"

  def seqElem =
    str | decimal | char | variable

  def char =
    "\'" ~> """[a-zA-Z0-9]""".r <~ "\'" ^^ { case str => str.toList(0) }

  def str =
    "\"" ~> ident <~ "\""

  def decimal =
    opt("-") ~ decimalNumber ^^ {
      case None ~ number => number.toInt
      case sign ~ number => number.toInt * -1
    }

  def float =
    floatingPointNumber ^^ { _.toFloat }

  def varSeqElem: Parser[Tuple2[Any, Any]] =
    "=" ~> varSeqElemValue

  def varSeqElemValue =
    simpleStr ~ index ^^ {
      //      case name ~ (index: Int) => (Tuple1(name), index)
      case name ~ index => (Tuple1(name), index)
    }

  def index: Parser[Any] =
    "[" ~> (varSeqElemValue | decimal | simpleStr) <~ "]" ^^ {
      case number: Int => number
      case varName: String => Tuple1(varName)
      case other => other
    }

  /* Config */

  def config =
    "config:" ~> rep(assignment)

  def signals =
    "signals:" ~> rep(signal)

  /* Signals */

  def signal =
    simpleStr ~ optSeqAfterName ~ signalBody <~ not(":") ^^ {
      case name ~ genSeq ~ assignments => (name, genSeq, assignments)
    }

  def optSeqAfterName =
    opt("[" ~> simpleStr <~ "]") ^^ {
      case Some(seq) => seq
      case None => null
    }

  def signalBody =
    opt("{" ~> rep(assignment) <~ "}") ^^ {
      case Some(assignments) => assignments
      case None => List()
    }

  def assignment =
    simpleStr ~ "=" ~ "\"" ~ rep(advStr | token) <~ "\"" ^^ {
      case name ~ _ ~ _ ~ value => (name, value)
    }

  def token =
    "$" ~> "{" ~> (varSeqElemValue | simpleStr) <~ "}" ^^ { case token => Tuple1(token) }

  def simpleStr: Parser[String] =
    """[a-zA-Z_]\w*""".r

  def advStr: Parser[String] =
    """[^\"\$]+""".r

  /* Functions */

  def functions =
    "functions:" ~> rep(functionName)

  /* Tasks */

  def tasks =
    "tasks:" ~> rep(task)

  def task =
    taskType ~ taskName ~ optSeqAfterName ~ taskBody ^^ {
      case taskType ~ name ~ seq ~ body => (taskType, name, seq, body)
    }

  def taskType =
    "foreach" | "splitter" | "stickyservice" | "task"

  def taskName =
    simpleStr

  def taskBody: Parser[List[(String, List[Any])]] =
    "{" ~> rep(taskFunction | taskIns | taskOuts | assignment) <~ "}"

  def taskFunction =
    "function" ~> "=" ~> functionName ^^ { case function => ("function", List(function)) }

  def functionName =
    simpleStr ~ "." ~ simpleStr ^^ { case module ~ _ ~ name => (module, name) }

  def taskIns =
    "ins" ~> "=" ~> repsep(inputOutput, ",") ^^ { case list => ("ins", list) }

  def taskOuts =
    "outs" ~> "=" ~> repsep(inputOutput, ",") ^^ { case list => ("outs", list) }

  def inputOutput =
    varSeqElemValue | tupledStr | ioAsterisk

  def tupledStr =
    simpleStr ^^ { case str => Tuple1(str) }

  def ioAsterisk =
    "*" ~> simpleStr ^^ { case name => (Tuple1(name), null) }

  /* Ins and Outs */

  def ins: Parser[List[Any]] =
    "ins:" ~> opt(repsep(insOutsVals, ",")) ^^ {
      case None => null
      case Some(other) => other
    }

  def outs: Parser[List[Any]] =
    "outs:" ~> opt(repsep(insOutsVals, ",")) ^^ {
      case None => null
      case Some(other) => other
    }

  def insOutsVals =
    ioVarSeqElemValue | ioTupledStr | ioAsterisk

  def ioVarSeqElemValue =
    not("outs:") ~> simpleStr ~ index ^^ {
      case name ~ index => (Tuple1(name), index)
    }

  def ioTupledStr =
    not("outs:") ~> simpleStr ^^ { case str => Tuple1(str) }

}
