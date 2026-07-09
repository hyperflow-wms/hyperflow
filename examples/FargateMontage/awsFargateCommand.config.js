exports.cluster_arn =
  "arn:aws:ecs:us-east-1:619561298126:cluster/hyperflow-cluster";
exports.subnet_1 = "subnet-0b305cea38e2c7948";
exports.metrics = true;

exports.options = {
  bucket: "hyperflow-fargate-1741442042347",
  prefix: "hyperflow",
};

exports.tasks_mapping = {
  default:
    "arn:aws:ecs:us-east-1:619561298126:task-definition/montage-worker:1",
  mProject:
    "arn:aws:ecs:us-east-1:619561298126:task-definition/montage-worker:1",
  mDiffFit:
    "arn:aws:ecs:us-east-1:619561298126:task-definition/montage-worker:2",
  mConcatFit:
    "arn:aws:ecs:us-east-1:619561298126:task-definition/montage-worker:1",
  mBgModel:
    "arn:aws:ecs:us-east-1:619561298126:task-definition/montage-worker:1",
  mBackground:
    "arn:aws:ecs:us-east-1:619561298126:task-definition/montage-worker:3",
  mImgtbl:
    "arn:aws:ecs:us-east-1:619561298126:task-definition/montage-worker:1",
  mAdd: "arn:aws:ecs:us-east-1:619561298126:task-definition/montage-worker:1",
  mShrink:
    "arn:aws:ecs:us-east-1:619561298126:task-definition/montage-worker:1",
  mJPEG: "arn:aws:ecs:us-east-1:619561298126:task-definition/montage-worker:3",
};

exports.vcpu_mapping = {
  default: 1024,
  mProject: 1024,
  mDiffFit: 512,
  mConcatFit: 1024,
  mBgModel: 1024,
  mBackground: 2048,
  mImgtbl: 1024,
  mAdd: 1024,
  mShrink: 1024,
  mJPEG: 2048,
};
