FROM ubuntu:18.04

# Install Ruby and Rails dependencies
RUN apt-get update && apt-get install -y \
  nodejs \
  nodejs-dev \
  npm 

COPY . /hyperflow
WORKDIR /hyperflow

RUN npm install

RUN ln -s /hyperflow/plugins/hyperflow-ecs-monitoring-plugin /hyperflow/node_modules/hyperflow-ecs-monitoring-plugin

WORKDIR /hyperflow/plugins/hyperflow-ecs-monitoring-plugin

RUN npm install

WORKDIR /hyperflow

CMD /hyperflow/bin/hflow run /workdir/dag.json -s -p hyperflow-ecs-monitoring-plugin
