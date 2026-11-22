# On a release, RELEASE_TAG names the release's tag: CI runs
# `make push RELEASE_TAG=<tag>`. Make reads it with $(value), so it does not
# expand a "$" in it. It is not exported to the recipes, because make expands
# a command-line variable when it exports it. The recipes' commands get the
# tag only through TAG and VERSION, below. MAKEFLAGS in the recipes'
# environment also holds RELEASE_TAG=<tag>, with each "$" doubled, for a
# sub-make; no recipe here reads it.
#
# Make refuses to run when RELEASE_TAG is not one of the tags on the
# checked-out commit, so a release image is built only from the commit its
# tag points at, and when it does not start with "v", because the release
# image must be tagged v<version>. Make itself compares RELEASE_TAG with each
# tag on that commit as an exact string (each contains the other), so the tag
# name reaches no shell here and a "%" in it is not a pattern. Both helper
# variables are set with "override", so a value given on the command line
# cannot get past the check. The rest of the tag, the version, is checked by
# scripts/check-version.sh when `make image` runs, also when it is empty, as
# for a tag named "v".
unexport RELEASE_TAG
ifneq ($(value RELEASE_TAG),)
override HEAD_TAGS := $(shell git tag --points-at HEAD 2>/dev/null)
override RELEASE_TAG_AT_HEAD := $(strip $(foreach t,$(HEAD_TAGS),$(and $(findstring $(value RELEASE_TAG),$(t)),$(findstring $(t),$(value RELEASE_TAG)))))
ifeq ($(RELEASE_TAG_AT_HEAD),)
$(error RELEASE_TAG=$(value RELEASE_TAG) is not a tag on the checked-out commit)
endif
ifeq ($(filter v%,$(value RELEASE_TAG)),)
$(error RELEASE_TAG=$(value RELEASE_TAG) does not start with "v": a release tag is "v" followed by the version)
endif
endif
# RELEASE_TAG when it is set; git describe then does not run. Otherwise the
# nearest version tag as `git describe` reports it: v1.11.2 on the tagged
# commit, v1.11.2-3-gabc1234 three commits later, and either one followed by
# -dirty when a tracked file has uncommitted changes. Only version tags, the
# tags that match v[0-9]*.[0-9]*.[0-9]*, count; tags of other names, such as
# prePersistence, v1.11 or 1.7.1, are skipped. Empty when RELEASE_TAG is not
# set and no version tag is reachable. TAG and VERSION both derive from it.
DESCRIBE := $(or $(value RELEASE_TAG),$(shell git describe --tags --dirty --match 'v[0-9]*.[0-9]*.[0-9]*' 2>/dev/null))
# Version written into the image's package.json: DESCRIBE without its leading
# "v". Empty when DESCRIBE is; the build then gets no VERSION argument and the
# image reports 0.0.0-dev.
VERSION := $(patsubst v%,%,$(DESCRIBE))
# Image tag: DESCRIBE, so RELEASE_TAG when it is set. When DESCRIBE is empty,
# the abbreviated commit hash, followed by -dirty in the same way.
TAG := $(or $(DESCRIBE),$(shell git describe --always --dirty --exclude='*' 2>/dev/null))
# VERSION and TAG come from a tag name, which can hold characters that a
# shell interprets, such as ; $ ` ( ) and quotes. They reach the recipes only
# through the environment, where a recipe refers to them as "$$VERSION" and
# "$$TAG", and never as text in a recipe line. Make exports a variable set
# with := as its stored value, without expanding it again.
export VERSION TAG
PREFIX = hyperflowwms
REPO_NAME = hyperflow
#REPO_NAME = $(shell git config --get remote.origin.url | tr ':.' '/'  | rev | cut -d '/' -f 2 | rev)

all: push

container: image 

# The first line prints the image tag and the version, also under `make -n`,
# without a shell. The second refuses a VERSION that is not strict semver
# 2.0.0, before anything is built, tagged or pushed. It runs whenever VERSION
# or RELEASE_TAG is set, so with RELEASE_TAG set an empty VERSION is refused
# too.
image:
	$(info Image tag: $(TAG); version: $(or $(VERSION),none))
	$(if $(or $(VERSION),$(value RELEASE_TAG)),sh scripts/check-version.sh "$$VERSION")
	docker build --no-cache $(if $(VERSION),--build-arg VERSION="$$VERSION") -t $(PREFIX)/$(REPO_NAME) . # Build new image and automatically tag it as latest
	docker tag $(PREFIX)/$(REPO_NAME) $(PREFIX)/$(REPO_NAME):"$$TAG"  # Add the version tag to the latest image

push: image
	docker push $(PREFIX)/$(REPO_NAME) # Push image tagged as latest to repository
	docker push $(PREFIX)/$(REPO_NAME):"$$TAG" # Push version tagged image to repository (since this image is already pushed it will simply create or update version tag)

clean:
