#!/usr/bin/env ruby
# frozen_string_literal: true
#
# Adds the "ScreenShare" Broadcast Upload Extension target to drs.xcodeproj and
# wires the main app for iOS screen sharing (App Group + entitlements + embed).
#
# Idempotent: re-running updates settings and skips re-creating the target.
# Run from ios/:  ruby scripts/add_screenshare_extension.rb
#
require 'xcodeproj'

PROJECT = File.expand_path('../drs.xcodeproj', __dir__)
APP_TARGET = 'drs'
EXT_TARGET = 'ScreenShare'
APP_BUNDLE_ID = 'com.drs.app'
EXT_BUNDLE_ID = 'com.drs.app.ScreenShare'
APP_GROUP = 'group.com.drs.app'
DEPLOYMENT = '13.0'

project = Xcodeproj::Project.open(PROJECT)
app = project.targets.find { |t| t.name == APP_TARGET }
raise "App target #{APP_TARGET} not found" unless app

# --- Main app: bundle id + entitlements --------------------------------------
app.build_configurations.each do |c|
  c.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = APP_BUNDLE_ID
  c.build_settings['CODE_SIGN_ENTITLEMENTS'] = 'drs/drs.entitlements'
end

# --- Create (or find) the extension target -----------------------------------
ext = project.targets.find { |t| t.name == EXT_TARGET }
if ext.nil?
  ext = project.new_target(:app_extension, EXT_TARGET, :ios, DEPLOYMENT)
  puts "Created target #{EXT_TARGET}"
else
  puts "Target #{EXT_TARGET} already exists; updating"
end

# File group for the extension sources (files live in ios/ScreenShare).
group = project.main_group.find_subpath('ScreenShare', true)
group.set_source_tree('SOURCE_ROOT')
group.set_path('ScreenShare')

sources = %w[SampleHandler.m DRSSocketConnection.m DRSSampleUploader.m]
headers = %w[SampleHandler.h DRSSocketConnection.h DRSSampleUploader.h]
plist_and_ent = %w[Info.plist ScreenShare.entitlements]

# Reset the extension's source phase to avoid duplicates on re-run.
ext.source_build_phase.files_references.dup.each { |r| ext.source_build_phase.remove_file_reference(r) }

(sources + headers + plist_and_ent).each do |name|
  next if group.files.any? { |f| f.display_name == name }
  group.new_reference(name)
end

sources.each do |name|
  ref = group.files.find { |f| f.display_name == name }
  ext.source_build_phase.add_file_reference(ref, true)
end

# --- Extension build settings ------------------------------------------------
ext.build_configurations.each do |c|
  bs = c.build_settings
  bs['PRODUCT_BUNDLE_IDENTIFIER'] = EXT_BUNDLE_ID
  bs['INFOPLIST_FILE'] = 'ScreenShare/Info.plist'
  bs['CODE_SIGN_ENTITLEMENTS'] = 'ScreenShare/ScreenShare.entitlements'
  bs['IPHONEOS_DEPLOYMENT_TARGET'] = DEPLOYMENT
  bs['SKIP_INSTALL'] = 'YES'
  bs['TARGETED_DEVICE_FAMILY'] = '1,2'
  bs['CLANG_ENABLE_MODULES'] = 'YES'
  bs['PRODUCT_NAME'] = '$(TARGET_NAME)'
  bs['SWIFT_VERSION'] = nil
  bs['CODE_SIGN_STYLE'] = 'Automatic'
end

# --- Link the frameworks the extension uses ----------------------------------
%w[ReplayKit CoreImage CoreMedia CoreVideo CFNetwork].each do |fw|
  path = "System/Library/Frameworks/#{fw}.framework"
  ref = project.frameworks_group.files.find { |f| f.path == path }
  ref ||= project.frameworks_group.new_reference(path).tap { |r| r.source_tree = 'SDKROOT' }
  next if ext.frameworks_build_phase.files_references.include?(ref)
  ext.frameworks_build_phase.add_file_reference(ref, true)
end

# --- App depends on + embeds the extension -----------------------------------
app.add_dependency(ext)

embed = app.copy_files_build_phases.find { |p| p.name == 'Embed App Extensions' }
if embed.nil?
  embed = app.new_copy_files_build_phase('Embed App Extensions')
  embed.symbol_dst_subfolder_spec = :plug_ins
end
unless embed.files_references.include?(ext.product_reference)
  bf = embed.add_file_reference(ext.product_reference, true)
  bf.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }
end

project.save
puts 'drs.xcodeproj updated: ScreenShare extension wired.'
