import com.github.retronym.SbtOneJar
import sbt._
import Keys._

object HelloBuild extends Build {
  val hwsettings = Defaults.defaultSettings ++ Seq(
    name := "wfdsl",
    version := "1.0.0",
    scalaVersion := "2.10.1",
    scalacOptions ++= Seq("-deprecation", "-feature"),
    libraryDependencies += "org.scalatest" % "scalatest_2.10" % "1.9.1" % "test",
    libraryDependencies += "junit" % "junit" % "4.10" % "test",
    exportJars := true)

  lazy val project = Project(
    id = "kompilatory",
    base = file("."),
    settings = hwsettings ++ SbtOneJar.oneJarSettings)
}
