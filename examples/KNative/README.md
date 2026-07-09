# Knative example

This example demonstrates using the hyperflow engine to deploy and invoke Knative function workflows.

## Prerequisites

- [**kind**](https://kind.sigs.k8s.io/docs/user/quick-start) or [**minikube**](https://minikube.sigs.k8s.io/docs/start/)
to run a local Kubernetes cluster
- [**kubectl**](https://kubernetes.io/docs/tasks/tools/) - the Kubernetes CLI
- [**kn**](https://kubernetes.io/docs/tasks/tools/) - the knative CLI

After installing those tools install [**kn quickstart**](https://kubernetes.io/docs/tasks/tools/) - a Knative quickstart
plugin and run one of the below commands depending on the used K8s distribution:
```
kn quickstart minikube
```
```
kn quickstart kind
```
Next follow the steps recommended by the command's output.


Once the cluster is set up you are ready to run this example workflow.

## Parameters

- `name` - name under which the service will be executed
- `image` - address of the image of the application
- `namespace` - Kubernetes namespace in which the service and its' pod will be created
(when none is provided the default namespace is used)
