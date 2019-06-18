---
layout: post
title:  "Fixing Fedora's Firefox Video Issues"
date:   2019-06-19 20:35:08 +0530
---

I recently installed Fedora on my laptop, overwriting the default windows partition. Its 2019 - "*the year of the linux desktop*", just like it has been from the 2000s. Fedora 30 was going to respark my love for the open source OS. One thing I completely forgot was the difference in the user experience between Windows and Linux. Among many other things, I found out soon that my touchpad did not work, my wifi drivers were missing and I had to install kernel-devel packages to manually compile, build and install these drivers to get the network working. Things which I had completely lost touch of, when working on Windows. 

One of the most infuriating things I noticed was the fact that some videos in Youtube don't play at all. 

![Youtube does not work in Fedora](/assets/youtube-codecs-fedora.png)

This was just after a fresh install. It turns out that Fedora does not come with the codecs required to watch all video content on Youtube or even Netflix. 

![Youtube HTML5 Videos on Fedora](/assets/firefox-youtube-html5-video.png)

I tried enabling DRM content on Firefox (which was disabled by default on Fedora) in Firefox -> Preferences -> General -> Play DRM Content, but this didn't help either. 

The only solution was to install the missing codecs - H.264. One of the easiest way to do that without manually downloading the missing codecs is to download the most popular plays-every-media-content-ever player of course, VLC. 

Downloading VLC isn't as straight-forward as running `dnf install vlc` on Fedora. The (VLC download page)[https://www.videolan.org/vlc/download-fedora.html] lists the instructions. You can run the below command:

`sudo dnf install https://download1.rpmfusion.org/free/fedora/rpmfusion-free-release-$(rpm -E %fedora).noarch.rpm`
`sudo dnf install https://download1.rpmfusion.org/nonfree/fedora/rpmfusion-nonfree-release-$(rpm -E %fedora).noarch.rpm`
`sudo dnf install vlc`

If the package install fails for you, replace `$(rpm -E %fedora)` with your Fedora version number, for example, 30. 

Once the install is done, close your Firefox and restart again. That should fix things. 

PS: For more codes, you can run the below command:

`sudo dnf install vlc-extras`

HTH.