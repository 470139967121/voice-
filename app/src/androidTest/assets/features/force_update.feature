Feature: Force Update
  As the app
  I want to require users to update
  So that they always run a supported version

  Scenario: Shows update required title
    Given I am on the "force_update" screen
    Then I should see the element with tag "forceUpdate_title"

  Scenario: Shows update button
    Given I am on the "force_update" screen
    Then I should see the element with tag "forceUpdate_updateButton"
