FROM node:16-alpine

ARG hf_job_executor_version
ENV HYPERFLOW_AWS_FARGATE_EXECUTOR_VERSION=$hf_job_executor_version

WORKDIR /usr/src/app

RUN npm install -g hyperflow-awsfargate-executor@${HYPERFLOW_AWS_FARGATE_EXECUTOR_VERSION} log4js
COPY . .

CMD [ "hflow-job-execute" ]