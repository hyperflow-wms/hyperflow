#!/bin/sh
# Checks that $1 is a version the engine image can carry: a strict semver
# 2.0.0 version without build metadata, such as 1.11.2, 1.12.0-rc.1 or
# 1.11.2-3-gabc1234-dirty. Exits 0 when it is. Otherwise it prints a message
# on stderr and exits 1.
#
# `make image` runs it before any docker command, and the Dockerfile runs it
# before `npm version`, which would also accept npm keywords such as "patch",
# options such as "--help", leading zeros and build metadata.
#
# Usage: sh scripts/check-version.sh <version>

LC_ALL=C
export LC_ALL

version=$1

fail() {
    printf '%s: "%s" is not a valid version: expected MAJOR.MINOR.PATCH or MAJOR.MINOR.PATCH-PRERELEASE (semver 2.0.0, without leading zeros or build metadata)\n' "${0##*/}" "$version" >&2
    exit 1
}

# Only digits, ASCII letters, "." and "-" can occur in such a version. A value
# with any other character, a newline included, is rejected here, before grep,
# which matches line by line, sees it.
case $version in
'' | *[!0-9A-Za-z.-]*) fail ;;
esac

# MAJOR.MINOR.PATCH, numbers without leading zeros, then optionally "-" and
# dot-separated pre-release identifiers, each either a number without leading
# zeros or digits, letters and hyphens with at least one letter or hyphen.
num='(0|[1-9][0-9]*)'
id='(0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)'
printf '%s\n' "$version" | grep -Eq "^$num\\.$num\\.$num(-$id(\\.$id)*)?\$" || fail
