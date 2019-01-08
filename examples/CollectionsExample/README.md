# "Count" control signal and collections

This example demonstrates how to use the "count" control signal to produce and consume collections of elements (signals). This workflow has 3 processes:
- Proc1 randomly produces a collection of 0-3 elements.
- Proc2 processes these elements one by one.
- Proc3 consumes all elements produced by Proc2 as a single collection.

Since we don't know the size of the collection, we use the "count" control signal passed between Proc1 and Proc3, so that Proc3 knows how many elements should be collected before activation. Note how the name of the "count" signal is used to associate the output collection of Proc1 with the input collection of Proc3.
