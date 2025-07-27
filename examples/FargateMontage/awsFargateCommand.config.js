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
    "arn:aws:ecs:us-east-1:619561298126:task-definition/montage-worker:3",
  mProject:
    "arn:aws:ecs:us-east-1:619561298126:task-definition/montage-worker:3",
  mDiffFit:
    "arn:aws:ecs:us-east-1:619561298126:task-definition/montage-worker:3",
  mConcatFit:
    "arn:aws:ecs:us-east-1:619561298126:task-definition/montage-worker:3",
  mBgModel:
    "arn:aws:ecs:us-east-1:619561298126:task-definition/montage-worker:3",
  mBackground:
    "arn:aws:ecs:us-east-1:619561298126:task-definition/montage-worker:3",
  mImgtbl:
    "arn:aws:ecs:us-east-1:619561298126:task-definition/montage-worker:3",
  mAdd: "arn:aws:ecs:us-east-1:619561298126:task-definition/montage-worker:3",
  mShrink:
    "arn:aws:ecs:us-east-1:619561298126:task-definition/montage-worker:3",
  mJPEG: "arn:aws:ecs:us-east-1:619561298126:task-definition/montage-worker:3",
};

exports.vcpu_mapping = {
  default: 1024,
  mProject: 1024,
  mDiffFit: 1024,
  mConcatFit: 1024,
  mBgModel: 1024,
  mBackground: 1024,
  mImgtbl: 1024,
  mAdd: 1024,
  mShrink: 1024,
  mJPEG: 1024,
};
