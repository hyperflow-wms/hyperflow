# On a release, RELEASE_TAG names the release's tag: CI runs
# `make push RELEASE_TAG=<tag> PRERELEASE=<true or false>`, with PRERELEASE
# deciding whether the image is also pushed as latest (see PUSH_LATEST
# below). Make reads RELEASE_TAG with $(value), so it does not expand a "$"
# in it. It is not exported to the recipes, because make expands a
# command-line variable when it exports it. The recipes' commands get the
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
# for a tag named "v". For `make push`, make refuses an empty version, and a
# VERSION or TAG that does not match RELEASE_TAG, while it reads this file
# (see below).
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
# "v". Empty when DESCRIBE is; `make image` then passes no VERSION argument
# and the image reports 0.0.0-dev, and `make push` refuses to run (see below).
VERSION := $(patsubst v%,%,$(DESCRIBE))
# Image tag: DESCRIBE, so RELEASE_TAG when it is set. When DESCRIBE is empty,
# the abbreviated commit hash, followed by -dirty in the same way. Empty
# outside a git checkout, as in a source archive.
TAG := $(or $(DESCRIBE),$(shell git describe --always --dirty --exclude='*' 2>/dev/null))
# VERSION and TAG come from a tag name, which can hold characters that a
# shell interprets, such as ; $ ` ( ) and quotes. They reach the recipes only
# through the environment, where a recipe refers to them as "$$VERSION" and
# "$$TAG", and never as text in a recipe line. Make exports a variable set
# with := as its stored value, without expanding it again.
export VERSION TAG

# The goals given on the command line; `make` without a goal runs the default
# goal, all, which pushes. A MAKECMDGOALS set on the command line or in the
# environment replaces the goals that make reports, so make then takes the
# goals to be all, and every check below applies.
override GOALS := $(if $(filter default undefined,$(origin MAKECMDGOALS)),$(or $(MAKECMDGOALS),all),all)

# Make refuses to build the image when its tag is empty: outside a git
# checkout, git describe finds no commit, and `docker tag` would fail only
# after a full build. TAG=<tag> on the command line gives a tag there.
ifneq ($(filter all container image push,$(GOALS)),)
ifeq ($(strip $(TAG)),)
$(error The image tag is empty: TAG= was given empty, or git describe found no commit, as outside a git checkout; build from a git clone, or give TAG=<tag>)
endif
endif

# Whether `make push` also pushes the image as latest: "yes" or "no", or
# empty for a PRERELEASE that make push refuses (see below). CI's deploy job
# sets PRERELEASE from the release's pre-release flag: "true" for a GitHub
# pre-release, which then pushes only v<version>, so that it does not move
# latest, and "false" for any other release, which pushes latest too. Without
# PRERELEASE, as in a local run, make push pushes latest too. Any other value,
# an empty one included, gives no decision, so a mistyped value does not push
# latest. Make compares $(value PRERELEASE) with "true" and "false" as exact
# strings. The decision depends on PRERELEASE alone, not on the version: a
# version such as 1.11.2-3-gabc1234, which git describe gives between
# releases, is a semver pre-release too, and make push pushes latest for it.
# PUSH_LATEST is set with "override", so a value given on the command line
# has no effect. PRERELEASE is not exported to the recipes, which do not read
# it, so make does not expand a command-line value of it to export it. The
# unexport comes after the decision, because it defines PRERELEASE, empty,
# when it is not set.
ifeq ($(origin PRERELEASE),undefined)
override PUSH_LATEST := yes
else ifeq ($(value PRERELEASE),false)
override PUSH_LATEST := yes
else ifeq ($(value PRERELEASE),true)
override PUSH_LATEST := no
else
override PUSH_LATEST :=
endif
unexport PRERELEASE

# `make push` publishes only an image with a version, as v<version> and, when
# PUSH_LATEST is yes, as latest. Make refuses to run it, before anything is
# built, when VERSION is empty: when no version tag is reachable, the image
# would report 0.0.0-dev, and a tag named "v" has no version. With RELEASE_TAG
# set, make also refuses when VERSION is not RELEASE_TAG without its "v", or
# TAG is not RELEASE_TAG, as when VERSION or TAG is given on the command line.
# Make compares the values itself, as exact strings, so they reach no shell.
# It also refuses a PRERELEASE that is set but neither "true" nor "false".
# These refusals hold under `make -n` and `make -i` too. `make image` without
# a version tag is allowed, for a local build, and `make image` is not
# affected by PRERELEASE.
ifneq ($(filter all push,$(GOALS)),)
ifneq ($(value RELEASE_TAG),)
ifneq ($(VERSION),$(patsubst v%,%,$(value RELEASE_TAG)))
$(error VERSION=$(VERSION) does not match RELEASE_TAG=$(value RELEASE_TAG): with RELEASE_TAG set, the version is RELEASE_TAG without its "v")
endif
ifneq ($(TAG),$(value RELEASE_TAG))
$(error TAG=$(TAG) does not match RELEASE_TAG=$(value RELEASE_TAG): with RELEASE_TAG set, the image tag is RELEASE_TAG)
endif
endif
ifeq ($(strip $(VERSION)),)
ifneq ($(value RELEASE_TAG),)
$(error RELEASE_TAG=$(value RELEASE_TAG) has an empty version: a release tag is "v" followed by the version)
endif
$(error make push needs a version, and VERSION is empty, as when no tag matching v[0-9]*.[0-9]*.[0-9]* is reachable from the checked-out commit; make image builds an image without a version, which reports 0.0.0-dev)
endif
ifeq ($(PUSH_LATEST),)
$(error PRERELEASE=$(value PRERELEASE) is neither "true" nor "false": PRERELEASE=true pushes only the version tag, PRERELEASE=false or no PRERELEASE pushes latest too)
endif
endif

PREFIX = hyperflowwms
REPO_NAME = hyperflow
#REPO_NAME = $(shell git config --get remote.origin.url | tr ':.' '/'  | rev | cut -d '/' -f 2 | rev)

all: push

container: image 

# The first line prints the image tag and the version, also under `make -n`,
# without a shell. The second refuses a VERSION that is not strict semver
# 2.0.0, before anything is built, tagged or pushed. It runs whenever VERSION
# or RELEASE_TAG is set, so with RELEASE_TAG set an empty VERSION is refused
# too; make itself refuses an empty VERSION only for `make push`.
image:
	$(info Image tag: $(TAG); version: $(or $(VERSION),none))
	$(if $(or $(VERSION),$(value RELEASE_TAG)),sh scripts/check-version.sh "$$VERSION")
	docker build --no-cache $(if $(VERSION),--build-arg VERSION="$$VERSION") -t $(PREFIX)/$(REPO_NAME) . # Build new image and automatically tag it as latest
	docker tag $(PREFIX)/$(REPO_NAME) $(PREFIX)/$(REPO_NAME):"$$TAG"  # Add the version tag to the latest image

# The first line prints whether the image is pushed as latest, also under
# `make -n`. The second pushes it as latest, the image name without a tag,
# only when PUSH_LATEST is yes. The third pushes the version tag.
push: image
	$(info Push latest: $(if $(filter yes,$(PUSH_LATEST)),yes,no (PRERELEASE=true)))
	$(if $(filter yes,$(PUSH_LATEST)),docker push $(PREFIX)/$(REPO_NAME) # Push image tagged as latest to repository)
	docker push $(PREFIX)/$(REPO_NAME):"$$TAG" # Push version tagged image to repository (since this image is already pushed it will simply create or update version tag)

clean:
