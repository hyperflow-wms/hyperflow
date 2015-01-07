#! /bin/bash
# Copyright 2013 University of Stuttgart, Germany
# Author: Anthony Sulistio (HLRS)
# Modified by Maciej Malawski (AGH)
#
# A script to convert POV files into PNG and create a movie based on these PNG files.
# Usage: ./make-movie.sh filename.tgz filename.avi


[ $# -lt 2 ] && { echo "Usage: $0 filename.tgz filename.avi"; exit 1; }

if [ -n "$1" ]; then
    INPUT=$1
fi

if [ -n "$2" ]; then
    MOVIE=$2
fi

DIR=$(mktemp -d --tmpdir=.)


cp $INPUT $DIR
cp -f pov-template.inc $DIR/psp-header.inc
cd $DIR
tar zxvf $INPUT



#Other image resolutions: 640 x 480 # 1024 x 768 # 1280 x 1024 # 1600 x 1200
WIDTH=1024  
HEIGHT=768 

# each core runs 1 povray job
NCORE=`cat /proc/cpuinfo | grep -i processor | wc -l`
SEC=5   # sleeping time in seconds
count=0

i=0
list=`ls *.pov`
for pov in $list
do
    { time povray -w$WIDTH -h$HEIGHT +A -D +WL0 -GA $pov; } 2> $pov.log  &
    #i=`exec $i + 1`
    i=$(( $i + 1 ))

    # pause to wait the existing jobs to finish, otherwise overloads the CPUs
    remainder=$(( $i % $NCORE ))
    if [ "$remainder" -eq 0 ] ; then
        sleep $SEC
        #count=`ps aux | grep povray | wc -l`
        #double=$(( $NCORE * 2 ))
        #if [ "$count" -ge $double ]; then
            #echo "i = $i sleeping $SEC ---- count = $count"
            #sleep $SEC
        #fi
    fi

    remainder=$(( $i % 10 ))
    if [ "$remainder" -eq 0 ] ; then
        echo "Converting $pov ..."
    fi
done

sleep 1

# check for running povray jobs.
count=`ps aux | grep povray | wc -l`
while [ "$count" -gt 1 ]  # NOTE: exclude the grep povray command itself
do
    #echo "waiting for pov jobs to finish .... count =" $count
    sleep $SEC
    count=`ps aux | grep povray | wc -l`
done

# remove these files
rm -f psp-initial.png psp-final*.png

mencoder mf://*.png -mf w=$WIDTH:h=$HEIGHT:fps=10:type=png -ovc lavc -lavcopts vcodec=mpeg4:mbd=2:trell -oac copy -o $MOVIE

mv $MOVIE ..


