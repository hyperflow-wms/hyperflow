FROM hyperflowwms/hyperflow-autoscaler-plugin

ENV NODE_PATH=/usr/local/lib/node_modules

COPY . /hyperflow

RUN npm install -g /hyperflow
