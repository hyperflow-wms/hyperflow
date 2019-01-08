# Choice and Join process types

This example demonstrates how to achieve the following workflow patterns:
- Produce results on a subset of a process' outputs (multi-choice)
- Activate a process by any n-out-of-m inputs (discriminator)
- Combine the above, i.e. the "choice" process sends information to the "join" process on how many outputs have been activated (structured synchronizing merge)

<P></P>
The workflow has two processes:

- <TT>WriteRandOuts</TT> randomly produces results on 0-3 of its outputs
- <TT>ReadRandIns</TT> is activated by <TT>n-out-of-3</TT> inputs, where <TT>n</TT> is the number of branches activated by the first process.  
  
<P>
  To achieve this, the processes are connected by the <TT>merge</TT> control signal. See the <A HREF=https://github.com/hyperflow-wms/hyperflow/wiki/Workflow-patterns>Structured synchronizing merge</A> to learn more about using this pattern. 
