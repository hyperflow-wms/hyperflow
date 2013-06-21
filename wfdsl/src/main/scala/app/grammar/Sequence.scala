package app.grammar

/*
 * Companion object converting a sequence "from A to B" to
 * a normalized form "from A to B step 1"
 */
object Sequence {
  def apply(from: Any, to: Any) = new Sequence(from, to, 1)
}

/*
 * A Sequence class, used in the parser to distinguish sequence definitions
 * from normal variables (which are passed as Tuple1 or Tuple2 and caused clashes)
 */
case class Sequence(val from: Any, val to: Any, val step: Any) {
	
}