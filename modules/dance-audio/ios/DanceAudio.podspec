Pod::Spec.new do |s|
  s.name           = 'DanceAudio'
  s.version        = '0.1.0'
  s.summary        = 'TempoLoop native audio services'
  s.description    = 'Local iOS audio extraction, waveform, and range playback for TempoLoop.'
  s.author         = 'TempoLoop'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true
  s.swift_version  = '5.9'

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = '**/*.swift'
end
