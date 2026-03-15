Feature: Unsafe Device
  As the app
  I want to block usage on unsafe devices
  So that users are protected from compromised environments

  Scenario: Shows shield icon title
    Given I am on the "unsafe_device" screen
    Then I should see the element with tag "unsafeDevice_title"

  Scenario: Shows not-supported description
    Given I am on the "unsafe_device" screen
    Then I should see the element with tag "unsafeDevice_description"
