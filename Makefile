# The nearest version tag as `git describe` reports it: v1.11.2 on the tagged
# commit, v1.11.2-3-gabc1234 three commits later, and either one followed by
# -dirty when a tracked file has uncommitted changes. Only version tags, the
# tags that match v[0-9]*.[0-9]*.[0-9]*, count; tags of other names, such as
# prePersistence, v1.11 or 1.7.1, are skipped. Empty when no version tag is
# reachable. TAG and VERSION both derive from it.
DESCRIBE := $(shell git describe --tags --dirty --match 'v[0-9]*.[0-9]*.[0-9]*' 2>/dev/null)
# Version written into the image's package.json: DESCRIBE without its leading
# "v". Empty when DESCRIBE is; the build then gets no VERSION argument and the
# image reports 0.0.0-dev.
VERSION := $(patsubst v%,%,$(DESCRIBE))
# Image tag: DESCRIBE, or, when no version tag is reachable, the abbreviated
# commit hash, followed by -dirty in the same way.
TAG := $(or $(DESCRIBE),$(shell git describe --always --dirty --exclude='*' 2>/dev/null))
PREFIX = hyperflowwms
REPO_NAME = hyperflow
#REPO_NAME = $(shell git config --get remote.origin.url | tr ':.' '/'  | rev | cut -d '/' -f 2 | rev)

all: push

container: image 

image:
	docker build --no-cache $(if $(VERSION),--build-arg VERSION=$(VERSION)) -t $(PREFIX)/$(REPO_NAME) . # Build new image and automatically tag it as latest
	docker tag $(PREFIX)/$(REPO_NAME) $(PREFIX)/$(REPO_NAME):$(TAG)  # Add the version tag to the latest image

push: image
	docker push $(PREFIX)/$(REPO_NAME) # Push image tagged as latest to repository
	docker push $(PREFIX)/$(REPO_NAME):$(TAG) # Push version tagged image to repository (since this image is already pushed it will simply create or update version tag)

clean:
