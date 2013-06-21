package app.generator

/*
 * A class representing a primitive Signal (SimpleSignal) considered
 * at the level of generated JSON. Each Signal is converted into
 * genSeq.size SimpleSignals (or 1 if there's null genSeq).
 * Keeps a reference to its parent (the Signal it was generated from)
 * for validation purposes.
 */
case class SimpleSignal(val globalIndex: Int, val parent: Signal) {

}