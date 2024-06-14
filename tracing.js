const { ConsoleSpanExporter} = require('@opentelemetry/tracing')
const { Resource } = require('@opentelemetry/resources')
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions')
const { getNodeAutoInstrumentations } = require("@opentelemetry/auto-instrumentations-node");
const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-http");
const { registerInstrumentations } = require('@opentelemetry/instrumentation')
const { NodeTracerProvider } = require("@opentelemetry/sdk-trace-node");
const { BatchSpanProcessor } = require("@opentelemetry/sdk-trace-base");

module.exports = (serviceName) => {

  const exporter = new OTLPTraceExporter({
    url: process.env.HF_VAR_OPT_URL+':4318/v1/traces'
  });

  const provider = new NodeTracerProvider({
    resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]:
          serviceName,
    }),
  });
  provider.addSpanProcessor(new BatchSpanProcessor(exporter));
  provider.addSpanProcessor(new BatchSpanProcessor(new ConsoleSpanExporter()));

  provider.register();

  const node_auto_instrumentations = [
        getNodeAutoInstrumentations({
          '@opentelemetry/instrumentation-fs': { enabled: false },
          '@opentelemetry/instrumentation-connect': {enabled: false},
          '@opentelemetry/instrumentation-redis': {enable: true},
          '@opentelemetry/instrumentation-redis-4': {enable: true}
        })
      ];
  const used_instrumentation = process.env.HF_VAR_ENABLE_TRACING  === "0" ? [] : node_auto_instrumentations;

  registerInstrumentations({
    instrumentations: used_instrumentation,
    tracerProvider: provider,
  });

  return provider.getTracer(serviceName);
}