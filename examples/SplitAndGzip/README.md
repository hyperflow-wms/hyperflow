

This example creates a split-parallel-join workflow of DAG type.

```

             split

           /   |   \
           
        gzip gzip gzip ...

           \   |   /

              tar

```
1. Split reads /etc/passwd and splits it into files file.000000, file.000001, etc.
2. Gzip compresses each file into file.gz, e.g. file.000000 -> file.000000.gz
3. Tar creates a tarball with all gzipped files -> tarball.tarball


Note: this a contrived example, since normally you use tar first and then gzip it.

Usage:

```
node gzip_dag_generator.js 3 > gzip3.json
hflow run gzip3.json
```
