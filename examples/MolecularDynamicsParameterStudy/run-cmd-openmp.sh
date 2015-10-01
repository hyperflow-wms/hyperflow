#!/bin/bash
# Copyright 2013 University of Stuttgart, Germany
# Author: Anthony Sulistio (HLRS)
# Modified by Maciej Malawski (AGH)
#
# usage: ./run.sh [num_molecule] [end_time] [temperature]
#
# Examples:
# To run 1000 molecules until 2 simulation time at temperature 0.8: 
# ./run.sh 1000 2 0.8


BASEDIR=$(dirname $BASH_SOURCE)


MYDIR=$(mktemp -d --tmpdir=.)

cp -vf $BASEDIR/pov-template.inc $MYDIR/psp-header.inc

cp $BASEDIR/src/main $MYDIR


cd $MYDIR
rm -f *.pov *.dat *.xyz
#cp -vf ../pov-template.inc psp-header.inc


## number of molecules
NUM=10000
if [ -n "$1" ]; then
    NUM=$1
fi

## how long it will run, i.e. the time step is 0.000 0.005 0.010 0.015 ... end time
END="0.05"
if [ -n "$2" ]; then
    END=$2
fi

## temperature
TEMPERATURE=0.85
if [ -n "$3" ]; then
    TEMPERATURE=$3
fi


echo "Running the molecular dynamics experiment"

echo ./main -v -N $NUM -n 0.9 -T $TEMPERATURE --domain-type=cube --timestep-length=0.005 \
--cutoff-radius=2 -m 1 --simulation-end-time=$END --molecule-container=BASICN2 --thermostat=velocity-scaling \
--simulation-equilibration-time=0.5 --gridgenerator-lattice-centering=primitive --n-per-subdomain=20 \
--generator=dropOverBasin --generator-drop-radius=2 --ascii-output --povray-output


./main -v -N $NUM -n 0.9 -T $TEMPERATURE --domain-type=cube --timestep-length=0.005 \
--cutoff-radius=2 -m 1 --simulation-end-time=$END --molecule-container=BASICN2 --thermostat=velocity-scaling \
--simulation-equilibration-time=0.5 --gridgenerator-lattice-centering=primitive --n-per-subdomain=20 \
--generator=dropOverBasin --generator-drop-radius=2 --ascii-output --povray-output

OUTPUT_FILE=psp-output-$TEMPERATURE.tgz

tar zcvf $OUTPUT_FILE psp-*

mv $OUTPUT_FILE ..
