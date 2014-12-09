This example shows how to generate a parameter study workflow for Molecular Dynamics (MD) application developed in PaaSage by HLRS.

Usage example:

* Generate workflow: 

```
node md_dag_generator.js 1000 0.5 0.6 0.1 > md_1.json
```

* Run workflow:

```
hflow run md_1.json
``` 

