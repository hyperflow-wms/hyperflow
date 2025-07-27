FROM busybox
WORKDIR /
RUN mkdir /data
COPY ./data/* /data/
VOLUME /data
CMD ["sh", "-c", "ls -l /data/"]