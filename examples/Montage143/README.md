This is a workflow graph for a small Montage workflow. It contains file names and commands, but in order to run it, you must provide the name of the function that implements the execution of workflow activities. For example:

```
hflow run . --var="function=command_print"
```
Only prints the commands. 

```
hflow run . --var="function=commandLocalMock"
```
Only prints the commands, but also creates (empty) output files and checks if all necessary input files (mocks) exist.

Tutorial on how to run Montage with a cloud executor can be found here:
https://github.com/dice-cyfronet/hyperflow/wiki/TutorialAMQP
