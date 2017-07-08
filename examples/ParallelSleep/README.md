

This example creates a split-parallel-join workflow of DAG type.

```

             fork

           /   |   \
           
        sleep sleep sleep ...

           \   |   /

              fork

```


Usage:

```
node sleep_generator.js 3 > sleep3.json
hflow run gzip3.json
```
