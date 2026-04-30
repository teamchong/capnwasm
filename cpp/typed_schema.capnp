@0xa1c4d2e3f5067890;

# Realistic typed schema. This is what users would actually deploy: a
# Cap'n Proto struct with named fields. Field offsets are known at compile
# time and accessed by integer index, not by string lookup.
#
# WideUserData mirrors the bench's wide-payload fixture but with the field
# names baked into the schema, the way Cap'n Proto is meant to be used.

struct WideUserData {
  field0   @0   :Text;
  field1   @1   :Text;
  field2   @2   :Text;
  field3   @3   :Text;
  field4   @4   :Text;
  field5   @5   :Text;
  field6   @6   :Text;
  field7   @7   :Text;
  field8   @8   :Text;
  field9   @9   :Text;
  field10  @10  :Text;
  field11  @11  :Text;
  field12  @12  :Text;
  field13  @13  :Text;
  field14  @14  :Text;
  field15  @15  :Text;
  field16  @16  :Text;
  field17  @17  :Text;
  field18  @18  :Text;
  field19  @19  :Text;
  field20  @20  :Text;
  field21  @21  :Text;
  field22  @22  :Text;
  field23  @23  :Text;
  field24  @24  :Text;
  field25  @25  :Text;
  field26  @26  :Text;
  field27  @27  :Text;
  field28  @28  :Text;
  field29  @29  :Text;
  field30  @30  :Text;
  field31  @31  :Text;
}
