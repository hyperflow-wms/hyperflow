package app.grammar

object Sequence {
  def apply(from: Any, to: Any) = new Sequence(from, to, 1)
}

case class Sequence(val from: Any, val to: Any, val step: Any) {
	
}