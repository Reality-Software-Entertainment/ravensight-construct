# Example event sheet

Add the Ravensight object to your project (Insert new object > Web >
Ravensight), set its **Ingest key** property, then build event sheets like
this one. Every action, condition and expression below ships in the addon.

```
System: On start of layout
    Ravensight: Level "forest_1" started
    Ravensight: Fetch remote config

Ravensight: On config ready
    Player: Set MaxSpeed to Ravensight.ConfigNumber("run_speed", 330)

Player: On destroyed
    Ravensight: Player died in "forest_1"

Goal: On collision with Player
    Ravensight: Level "forest_1" completed
    Ravensight: Track "coins_collected" with "amount" = Player.Coins

Shop: On purchase complete
    Ravensight: Purchase of "gems" "gem_pack_small" for 499 "USD"

Ads: On rewarded ad paid (revenue in major units from your ad plugin)
    Ravensight: Ad revenue Ads.Revenue "USD" from "admob" (Rewarded)

Settings: On "Analytics" checkbox clicked
    Ravensight: Set tracking enabled to AnalyticsCheckbox.IsChecked

Ravensight: On session failed
    System: Log "Ravensight: " & Ravensight.StatusReason
```

`Track event` takes a JSON object as text for more than one property:
`"{""level"": ""forest_1"", ""hp"": " & Player.HP & "}"`.
