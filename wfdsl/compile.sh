#!/bin/bash

mkdir bin
rm -rf bin/*
scalac -cp libs/junit-4.10.jar:libs/scalatest_2.10-1.9.1.jar -d bin -sourcepath src src/app/Main.scala
scalac -cp libs/junit-4.10.jar:libs/scalatest_2.10-1.9.1.jar -d bin -sourcepath src test/app/*
