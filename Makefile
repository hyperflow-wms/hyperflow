TAG = $(shell git describe --tags --always)
# Version written into the image's package.json: the `git describe --tags`
# output without its leading "v". Empty when no tag is reachable; the build then gets no
# VERSION argument and the image reports 0.0.0-dev.
VERSION = $(shell git describe --tags 2>/dev/null | sed 's/^v//')
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
