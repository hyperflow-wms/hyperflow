TAG := $(shell git describe --tags --always --match 'v[0-9]*')
VERSION = $(patsubst v%,%,$(TAG))
PREFIX = hyperflowwms
REPO_NAME = hyperflow
#REPO_NAME = $(shell git config --get remote.origin.url | tr ':.' '/'  | rev | cut -d '/' -f 2 | rev)

all: push

container: image 

image:
	docker build --no-cache --build-arg VERSION="$(VERSION)" -t $(PREFIX)/$(REPO_NAME) . # Build new image and automatically tag it as latest
	docker tag $(PREFIX)/$(REPO_NAME) $(PREFIX)/$(REPO_NAME):"$(TAG)"  # Add the version tag to the latest image

push: image
	docker push $(PREFIX)/$(REPO_NAME):"$(TAG)" # Push version tagged image to repository
	case "$(TAG)" in v[0-9]*.[0-9]*.[0-9]*-*) ;; v[0-9]*.[0-9]*.[0-9]*) docker push $(PREFIX)/$(REPO_NAME) ;; esac # Push latest only for a plain vX.Y.Z tag

clean:
