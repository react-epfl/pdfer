#!/usr/bin/env bash

# bump version
docker run --rm -v "$PWD":/app treeder/bump patch
version=`cat VERSION`
