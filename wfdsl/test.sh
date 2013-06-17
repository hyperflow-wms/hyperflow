#!/bin/bash

scala -cp libs/junit-4.10.jar:libs/scalatest_2.10-1.9.1.jar:bin org.scalatest.run app.GeneratorSuite
scala -cp libs/junit-4.10.jar:libs/scalatest_2.10-1.9.1.jar:bin org.scalatest.run app.GrammarSuite
